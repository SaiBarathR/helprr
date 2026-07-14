import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireCapability: vi.fn(),
  requireUserCapability: vi.fn(),
  getCurrentUser: vi.fn(),
  runWithOperationAudit: vi.fn(),
  snapshotTorrentDeleteTargets: vi.fn(),
  invalidateTaggedLibrary: vi.fn(),
  invalidateReferenceLabels: vi.fn(),
  bumpQbitCacheVersion: vi.fn(),
  bumpQueueCacheVersion: vi.fn(),
  sonarr: {
    getSeriesById: vi.fn(),
    deleteSeries: vi.fn(),
    deleteSeriesBulk: vi.fn(),
    deleteQueueItem: vi.fn(),
  },
  radarr: {
    getMovieById: vi.fn(),
    deleteMovie: vi.fn(),
    deleteMoviesBulk: vi.fn(),
    deleteQueueItem: vi.fn(),
  },
  lidarr: {
    getArtistById: vi.fn(),
    getAlbumById: vi.fn(),
    deleteArtist: vi.fn(),
    deleteAlbum: vi.fn(),
    deleteArtistsBulk: vi.fn(),
    deleteQueueItem: vi.fn(),
  },
  qbit: {
    deleteTorrent: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.requireAuth,
  requireCapability: mocks.requireCapability,
  requireUserCapability: mocks.requireUserCapability,
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClient: vi.fn().mockResolvedValue(mocks.sonarr),
  getRadarrClient: vi.fn().mockResolvedValue(mocks.radarr),
  getLidarrClient: vi.fn().mockResolvedValue(mocks.lidarr),
  getQBittorrentClient: vi.fn().mockResolvedValue(mocks.qbit),
}));
vi.mock('@/lib/file-audit', () => ({
  runWithOperationAudit: mocks.runWithOperationAudit,
  snapshotTorrentDeleteTargets: mocks.snapshotTorrentDeleteTargets,
}));
vi.mock('@/lib/cache/tagged-library', () => ({
  invalidateTaggedLibrary: mocks.invalidateTaggedLibrary,
}));
vi.mock('@/lib/cache/reference-labels', () => ({
  invalidateReferenceLabels: mocks.invalidateReferenceLabels,
}));
vi.mock('@/lib/cache/qbittorrent-version', () => ({
  bumpQbitCacheVersion: mocks.bumpQbitCacheVersion,
}));
vi.mock('@/lib/activity-queue', () => ({
  bumpQueueCacheVersion: mocks.bumpQueueCacheVersion,
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));
vi.mock('@/lib/api-error', () => ({
  upstreamErrorResponse: (error: unknown, fallback: string) => NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 502 },
  ),
}));

import { DELETE as deleteSeries } from '@/app/api/sonarr/[id]/route';
import { DELETE as deleteSeriesBulk } from '@/app/api/sonarr/editor/route';
import { DELETE as deleteMoviesBulk } from '@/app/api/radarr/editor/route';
import { DELETE as deleteArtist } from '@/app/api/lidarr/[id]/route';
import { DELETE as deleteAlbum } from '@/app/api/lidarr/album/[albumId]/route';
import { DELETE as deleteArtistsBulk } from '@/app/api/lidarr/editor/route';
import { DELETE as deleteQueueItem } from '@/app/api/activity/queue/[id]/route';
import { POST as torrentAction } from '@/app/api/qbittorrent/route';
import { POST as torrentHashAction } from '@/app/api/qbittorrent/[hash]/route';

const user = { id: 'user-1', username: 'owner' };

function request(path: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('destructive route audit wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(null);
    mocks.requireCapability.mockResolvedValue(null);
    mocks.requireUserCapability.mockResolvedValue({ ok: true, user, session: {} });
    mocks.getCurrentUser.mockResolvedValue(user);
    mocks.runWithOperationAudit.mockImplementation(async (_input, operation: () => Promise<unknown>) => operation());
    mocks.snapshotTorrentDeleteTargets.mockResolvedValue({
      targetTitle: 'Example torrent',
      itemCount: 1,
      details: { hashes: ['abc'], targets: [{ hash: 'abc', name: 'Example torrent' }] },
    });
    mocks.sonarr.getSeriesById.mockResolvedValue({ id: 12, title: 'Series' });
    mocks.radarr.getMovieById.mockResolvedValue({ id: 5, title: 'Movie' });
    mocks.lidarr.getArtistById.mockResolvedValue({ id: 7, artistName: 'Artist' });
    mocks.lidarr.getAlbumById.mockResolvedValue({ id: 8, title: 'Album', artistId: 7 });
  });

  it('audits single and bulk whole-media deletions with exact targets and file choices', async () => {
    const responses = [
      await deleteSeries(
        request('/api/sonarr/12?instanceId=sonarr-1&deleteFiles=true', 'DELETE'),
        { params: Promise.resolve({ id: '12' }) },
      ),
      await deleteSeriesBulk(
        request('/api/sonarr/editor?instanceId=sonarr-1', 'DELETE', { ids: [12, 13], deleteFiles: false }),
      ),
      await deleteMoviesBulk(
        request('/api/radarr/editor?instanceId=radarr-1', 'DELETE', { ids: [5, 6], deleteFiles: false }),
      ),
      await deleteArtist(
        request('/api/lidarr/7?instanceId=lidarr-1&deleteFiles=false', 'DELETE'),
        { params: Promise.resolve({ id: '7' }) },
      ),
      await deleteAlbum(
        request('/api/lidarr/album/8?instanceId=lidarr-1&deleteFiles=true', 'DELETE'),
        { params: Promise.resolve({ albumId: '8' }) },
      ),
      await deleteArtistsBulk(
        request('/api/lidarr/editor?instanceId=lidarr-1', 'DELETE', { ids: [7, 9], deleteFiles: true }),
      ),
    ];

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(mocks.runWithOperationAudit).toHaveBeenCalledTimes(6);
    expect(mocks.runWithOperationAudit.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({ service: 'SONARR', operation: 'DELETE_MEDIA', targetType: 'series', targetId: 12, filesDeleted: true }),
      expect.objectContaining({ service: 'SONARR', operation: 'DELETE_MEDIA', targetType: 'series', itemCount: 2, filesDeleted: false, details: { targetIds: [12, 13], deleteFiles: false, bulk: true } }),
      expect.objectContaining({ service: 'RADARR', operation: 'DELETE_MEDIA', targetType: 'movie', itemCount: 2, filesDeleted: false, details: { targetIds: [5, 6], deleteFiles: false, bulk: true } }),
      expect.objectContaining({ service: 'LIDARR', operation: 'DELETE_MEDIA', targetType: 'artist', targetId: 7, filesDeleted: false }),
      expect.objectContaining({ service: 'LIDARR', operation: 'DELETE_MEDIA', targetType: 'album', targetId: 8, filesDeleted: true }),
      expect.objectContaining({ service: 'LIDARR', operation: 'DELETE_MEDIA', targetType: 'artist', itemCount: 2, filesDeleted: true, details: { targetIds: [7, 9], deleteFiles: true, bulk: true } }),
    ]);
    expect(mocks.sonarr.deleteSeries).toHaveBeenCalledWith(12, true);
    expect(mocks.sonarr.deleteSeriesBulk).toHaveBeenCalledWith([12, 13], false);
    expect(mocks.radarr.deleteMoviesBulk).toHaveBeenCalledWith([5, 6], false);
    expect(mocks.lidarr.deleteArtist).toHaveBeenCalledWith(7, false);
    expect(mocks.lidarr.deleteAlbum).toHaveBeenCalledWith(8, true);
    expect(mocks.lidarr.deleteArtistsBulk).toHaveBeenCalledWith([7, 9], true);
  });

  it('audits both qBittorrent delete action endpoints, including delete-data choice', async () => {
    const responses = [
      await torrentAction(request('/api/qbittorrent', 'POST', { hash: 'abc', action: 'delete', deleteFiles: true })),
      await torrentHashAction(
        request('/api/qbittorrent/abc', 'POST', { action: 'delete', deleteFiles: false }),
        { params: Promise.resolve({ hash: 'abc' }) },
      ),
    ];

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(mocks.runWithOperationAudit).toHaveBeenCalledTimes(2);
    expect(mocks.runWithOperationAudit.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({ service: 'QBITTORRENT', operation: 'DELETE_TORRENT', filesDeleted: true }),
      expect.objectContaining({ service: 'QBITTORRENT', operation: 'DELETE_TORRENT', filesDeleted: false }),
    ]);
    expect(mocks.qbit.deleteTorrent).toHaveBeenNthCalledWith(1, 'abc', true);
    expect(mocks.qbit.deleteTorrent).toHaveBeenNthCalledWith(2, 'abc', false);
  });

  it('audits manual Arr queue removal and all destructive options', async () => {
    const response = await deleteQueueItem(
      request('/api/activity/queue/33?source=lidarr&instanceId=lidarr-1&removeFromClient=true&blocklist=true&skipRedownload=true', 'DELETE'),
      { params: Promise.resolve({ id: '33' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.runWithOperationAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'LIDARR',
        operation: 'REMOVE_QUEUE',
        targetType: 'queue',
        targetId: 33,
        filesDeleted: true,
        details: expect.objectContaining({
          queueId: 33,
          removeFromClient: true,
          blocklist: true,
          skipRedownload: true,
        }),
      }),
      expect.any(Function),
    );
    expect(mocks.lidarr.deleteQueueItem).toHaveBeenCalledWith(33, {
      removeFromClient: true,
      blocklist: true,
      changeCategory: false,
      skipRedownload: true,
    });
  });

  it('does not mutate or audit when capability authorization is denied', async () => {
    mocks.requireUserCapability.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await deleteSeries(
      request('/api/sonarr/12?deleteFiles=true', 'DELETE'),
      { params: Promise.resolve({ id: '12' }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.runWithOperationAudit).not.toHaveBeenCalled();
    expect(mocks.sonarr.deleteSeries).not.toHaveBeenCalled();
  });

  it('does not create a misleading audit attempt for an invalid target', async () => {
    const response = await deleteSeries(
      request('/api/sonarr/not-a-number?deleteFiles=true', 'DELETE'),
      { params: Promise.resolve({ id: 'not-a-number' }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.runWithOperationAudit).not.toHaveBeenCalled();
    expect(mocks.sonarr.deleteSeries).not.toHaveBeenCalled();
  });
});
