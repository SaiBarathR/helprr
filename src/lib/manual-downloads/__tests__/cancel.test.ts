import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: {} as Record<string, ReturnType<typeof vi.fn>>,
  update: vi.fn<(input: { data: Record<string, unknown> }) => Promise<object>>(async () => ({})),
  others: 0,
  audits: [] as Array<{ operation: string; filesDeleted: boolean | null }>,
  qbit: { getTorrents: vi.fn(async () => [{ hash: 'x' }]), deleteTorrent: vi.fn(async () => {}) },
  claim: vi.fn(async (): Promise<{ id: string; at: Date } | null> => ({ id: 'md1', at: new Date() })),
  release: vi.fn(async (...args: unknown[]) => args.length > 0),
}));
vi.mock('../fallback', () => ({ claimFallback: mocks.claim, releaseClaim: mocks.release }));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: async () => mocks.qbit }));
vi.mock('@/lib/db', () => ({ prisma: { manualDownload: { update: mocks.update, count: async () => mocks.others } } }));
vi.mock('@/lib/arr-instances', () => ({ resolveConnection: vi.fn(async () => ({ id: 'i1' })) }));
vi.mock('@/lib/cache/tagged-library', () => ({ invalidateTaggedLibrary: vi.fn(async () => {}) }));
vi.mock('@/lib/activity-queue', () => ({
  bumpQueueCacheVersion: vi.fn(async () => {}),
  fetchAllQueueRecords: (client: { getQueue: () => Promise<unknown> }) => client.getQueue(),
}));
vi.mock('@/lib/file-audit', () => ({
  snapshotTorrentDeleteTargets: async () => ({ targetTitle: 'Night.of.the.Living.Dead', itemCount: 1, details: {} }),
  runWithOperationAudit: async (input: { operation: string; filesDeleted: boolean | null }, call: () => Promise<unknown>) => {
    mocks.audits.push({ operation: input.operation, filesDeleted: input.filesDeleted });
    return call();
  },
}));
vi.mock('../preflight', async (importOriginal) => ({ ...(await importOriginal<typeof import('../preflight')>()), arrClientFor: () => mocks.client }));

import { AxiosError, AxiosHeaders } from 'axios';
import { cancelManualDownload, ManualDownloadCancelError } from '../cancel';

const HASH = '382CC016FF22946008ECDDCB0DDA820F42B0CD5A';
const download = (extra: Record<string, unknown> = {}) => ({
  id: 'md1', status: 'QUEUED', service: 'RADARR', instanceId: 'i1', instanceLabel: 'Radarr', infoHash: HASH,
  arrItemId: 15, arrItemTitle: 'Night of the Living Dead', createdArrItem: true, updatedAt: new Date(Date.now() - 10 * 60_000), ...extra,
}) as never;
const actor = { id: 'u1', username: 'admin' };
const none = { removeFromClient: false, blocklist: false, removeTitle: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.audits.length = 0;
  mocks.others = 0;
  mocks.client = {
    getQueue: vi.fn(async () => ({ records: [{ id: 101, downloadId: HASH }, { id: 102, downloadId: 'OTHER' }] })),
    deleteQueueItem: vi.fn(async () => {}),
    getMovieFiles: vi.fn(async () => []),
    deleteMovie: vi.fn(async () => {}),
    getHistory: vi.fn(async () => ({ records: [{ eventType: 'grabbed' }] })),
    refreshMonitoredDownloads: vi.fn(async () => ({ id: 1 })),
  };
});

describe('cancelling a manual download', () => {
  it("removes only this release from Arr's queue, keeping the torrent unless asked", async () => {
    const message = await cancelManualDownload(download(), none, actor);

    expect(mocks.client.deleteQueueItem).toHaveBeenCalledExactlyOnceWith(101, { removeFromClient: false, blocklist: false, skipRedownload: true });
    expect(message).toContain('the torrent stays in the download client');
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }));
  });

  it('removes the torrent and data, and the film it added while it has no files', async () => {
    const message = await cancelManualDownload(download(), { removeFromClient: true, blocklist: true, removeTitle: true }, actor);

    expect(mocks.client.deleteQueueItem).toHaveBeenCalledWith(101, { removeFromClient: true, blocklist: true, skipRedownload: true });
    expect(mocks.client.deleteMovie).toHaveBeenCalledWith(15, false, false);
    expect(mocks.audits).toEqual([{ operation: 'REMOVE_QUEUE', filesDeleted: true }, { operation: 'DELETE_MEDIA', filesDeleted: false }]);
    expect(message).toContain('was removed');
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ arrItemId: null }) }));
  });

  it('clears the series link too, including a title Arr says is already gone', async () => {
    mocks.client.getEpisodeFiles = vi.fn(async () => []);
    mocks.client.deleteSeries = vi.fn(async () => {});
    await cancelManualDownload(download({ service: 'SONARR' }), { ...none, removeTitle: true }, actor);
    expect(mocks.client.deleteSeries).toHaveBeenCalledWith(15, false);
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ arrItemId: null }) }));

    mocks.client.getMovieFiles.mockRejectedValueOnce(new AxiosError('gone', '404', undefined, undefined, {
      status: 404, statusText: 'Not Found', data: {}, headers: {}, config: { headers: new AxiosHeaders() },
    }));
    await cancelManualDownload(download(), { ...none, removeTitle: true }, actor);
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ arrItemId: null }) }));
  });

  it('never removes a film that was already there, or that has files', async () => {
    await cancelManualDownload(download({ createdArrItem: false }), { ...none, removeTitle: true }, actor);
    mocks.client.getMovieFiles.mockResolvedValue([{ id: 7 }]);
    const message = await cancelManualDownload(download(), { ...none, removeTitle: true }, actor);

    expect(mocks.client.deleteMovie).not.toHaveBeenCalled();
    expect(message).toContain('has files now, so it stays');
    expect(mocks.update.mock.calls.every(([input]) => !('arrItemId' in input.data))).toBe(true);
  });

  it('refuses a download that has finished', async () => {
    await expect(cancelManualDownload(download({ status: 'IMPORTED' }), none, actor)).rejects.toBeInstanceOf(ManualDownloadCancelError);
  });

  it('waits for Arr to list a fresh grab before removing it', async () => {
    vi.useFakeTimers();
    try {
      mocks.client.getQueue
        .mockResolvedValueOnce({ records: [] })
        .mockResolvedValue({ records: [{ id: 101, downloadId: HASH }] });
      const cancelling = cancelManualDownload(download(), { ...none, removeFromClient: true }, actor);
      await vi.advanceTimersByTimeAsync(2_000);
      await cancelling;
      expect(mocks.client.refreshMonitoredDownloads).toHaveBeenCalledOnce();
      expect(mocks.client.deleteQueueItem).toHaveBeenCalledWith(101, { removeFromClient: true, blocklist: false, skipRedownload: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('changes nothing when a grab never shows up in the queue', async () => {
    vi.useFakeTimers();
    try {
      mocks.client.getQueue.mockResolvedValue({ records: [] });
      const cancelling = cancelManualDownload(download(), { removeFromClient: true, blocklist: false, removeTitle: true }, actor);
      const outcome = cancelling.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await outcome).toBeInstanceOf(ManualDownloadCancelError);
      expect(mocks.client.deleteQueueItem).not.toHaveBeenCalled();
      expect(mocks.client.deleteMovie).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a download Arr already finished with, without waiting', async () => {
    mocks.client.getQueue.mockResolvedValue({ records: [] });
    mocks.client.getHistory.mockResolvedValue({ records: [{ eventType: 'grabbed' }, { eventType: 'downloadFailed' }] });

    const message = await cancelManualDownload(download(), none, actor);

    expect(message).toContain('not in Radarr');
    expect(mocks.client.refreshMonitoredDownloads).not.toHaveBeenCalled();
  });

  it('cancels an older grab that is not listed, as one removed outside Helprr, without waiting', async () => {
    mocks.client.getQueue.mockResolvedValue({ records: [] });
    mocks.client.getHistory.mockResolvedValue({ records: [{ eventType: 'grabbed', date: new Date(Date.now() - 10 * 60_000).toISOString() }] });

    const message = await cancelManualDownload(download({ status: 'BLOCKED' }), { ...none, removeTitle: true }, actor);

    expect(message).toContain('not in Radarr');
    expect(mocks.client.refreshMonitoredDownloads).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }));
  });

  it('cancels when the film it added was already removed in Radarr', async () => {
    const response = { status: 404, statusText: 'Not Found', headers: {}, config: { headers: new AxiosHeaders() }, data: {} };
    mocks.client.deleteMovie.mockRejectedValue(new AxiosError('Request failed with status code 404', 'ERR_BAD_REQUEST', undefined, undefined, response));

    const message = await cancelManualDownload(download(), { ...none, removeTitle: true }, actor);

    expect(message).toContain('Night of the Living Dead is no longer in Radarr');
    expect(mocks.update).toHaveBeenCalled();
  });

  it('waits while a send whose answer was lost may still be taken by Radarr', async () => {
    mocks.client.getQueue.mockResolvedValue({ records: [] });
    mocks.client.getHistory.mockResolvedValue({ records: [] });
    await expect(cancelManualDownload(download({ status: 'BLOCKED', updatedAt: new Date() }), { ...none, removeTitle: true }, actor))
      .rejects.toThrow('may still be taking this release');
    expect(mocks.client.deleteMovie).not.toHaveBeenCalled();

    // Two minutes on, with still no grab: nothing of it is in Radarr, and the film it added goes.
    expect(await cancelManualDownload(download({ status: 'BLOCKED' }), { ...none, removeTitle: true }, actor)).toContain('was removed');
  });

  it('keeps a film it added while another download is on its way for it', async () => {
    mocks.others = 1;
    const message = await cancelManualDownload(download(), { ...none, removeTitle: true }, actor);
    expect(message).toContain('another download is on its way for Night of the Living Dead');
    expect(mocks.client.deleteMovie).not.toHaveBeenCalled();
  });

  it('refuses a download still being sent', async () => {
    await expect(cancelManualDownload(download({ status: 'SUBMITTING_RELEASE' }), none, actor)).rejects.toBeInstanceOf(ManualDownloadCancelError);
  });

  describe('a fallback download (its torrent is Helprr\'s own, not in Arr\'s queue)', () => {
    const fallback = (extra: Record<string, unknown> = {}) => download({ mode: 'QBIT_REVIEWED', status: 'NEEDS_MAPPING', ...extra });

    it('deletes the torrent and its data from qBittorrent when asked, never touching Arr\'s queue', async () => {
      const message = await cancelManualDownload(fallback(), { ...none, removeFromClient: true, removeTitle: true }, actor);
      // Taken first, like a scan or an import, and cancelled only while still held.
      expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ id: 'md1', status: 'NEEDS_MAPPING' }), 'Cancelling.');
      expect(mocks.release).toHaveBeenCalledExactlyOnceWith({ id: 'md1', at: expect.any(Date) }, 'CANCELLED', message, { arrItemId: null });
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.qbit.deleteTorrent).toHaveBeenCalledWith(HASH.toLowerCase(), true);
      expect(mocks.audits.map((audit) => audit.operation)).toEqual(['DELETE_TORRENT', 'DELETE_MEDIA']);
      // The queue is only read, for another download of the title.
      expect(mocks.client.deleteQueueItem).not.toHaveBeenCalled();
      expect(message).toContain('removed the torrent and its data from qBittorrent');
    });

    it('keeps the torrent unless asked, and waits while Arr imports', async () => {
      expect(await cancelManualDownload(fallback(), none, actor)).toContain('the torrent stays in qBittorrent');
      expect(mocks.qbit.deleteTorrent).not.toHaveBeenCalled();
      await expect(cancelManualDownload(fallback({ status: 'IMPORTING' }), none, actor)).rejects.toBeInstanceOf(ManualDownloadCancelError);
    });

    it('never runs alongside a scan or an import of the files', async () => {
      await expect(cancelManualDownload(fallback({ status: 'IMPORT_PENDING' }), { ...none, removeFromClient: true }, actor)).rejects.toThrow('reading or importing the files');
      mocks.claim.mockResolvedValueOnce(null);
      await expect(cancelManualDownload(fallback(), { ...none, removeFromClient: true }, actor)).rejects.toThrow('changed meanwhile');
      expect(mocks.qbit.deleteTorrent).not.toHaveBeenCalled();
      expect(mocks.release).not.toHaveBeenCalled();
    });

    it('puts it back as it was when removing it fails, so it can be cancelled again', async () => {
      mocks.qbit.deleteTorrent.mockRejectedValueOnce(new Error('qBittorrent at http://admin:hunter2@qbit:8080 refused'));
      await expect(cancelManualDownload(fallback({ lastError: 'Confirm what the files are.' }), { ...none, removeFromClient: true }, actor)).rejects.toThrow('refused');
      expect(mocks.release).toHaveBeenCalledExactlyOnceWith(
        { id: 'md1', at: expect.any(Date) }, 'NEEDS_MAPPING', expect.stringMatching(/^Cancelling did not finish: .*refused$/), { lastError: 'Confirm what the files are.' },
      );
      expect(String(mocks.release.mock.calls[0][2])).not.toContain('hunter2');
    });
  });
});
