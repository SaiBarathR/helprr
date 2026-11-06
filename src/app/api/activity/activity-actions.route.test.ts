import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  runWithOperationAudit: vi.fn(),
  recordOperationAudit: vi.fn(),
  fetchAllQueueRecords: vi.fn(),
  bumpQueueCacheVersion: vi.fn(),
  listConnections: vi.fn(),
  getSonarrClient: vi.fn(),
  getRadarrClient: vi.fn(),
  getLidarrClient: vi.fn(),
  sonarr: { markHistoryFailed: vi.fn(), grabQueueItem: vi.fn(), deleteQueueBulk: vi.fn() },
  radarr: { markHistoryFailed: vi.fn(), grabQueueItem: vi.fn(), deleteQueueBulk: vi.fn() },
  lidarr: { markHistoryFailed: vi.fn(), grabQueueItem: vi.fn(), deleteQueueBulk: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/arr-instances', () => ({ listConnections: mocks.listConnections, resolveConnection: vi.fn() }));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClient: mocks.getSonarrClient,
  getRadarrClient: mocks.getRadarrClient,
  getLidarrClient: mocks.getLidarrClient,
}));
vi.mock('@/lib/file-audit', () => ({
  runWithOperationAudit: mocks.runWithOperationAudit,
  recordOperationAudit: mocks.recordOperationAudit,
}));
vi.mock('@/lib/activity-queue', () => ({
  bumpQueueCacheVersion: mocks.bumpQueueCacheVersion,
  fetchAllQueueRecords: mocks.fetchAllQueueRecords,
  getQueueCached: vi.fn(),
  getQueueNeedingImportCached: vi.fn(),
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { POST as markFailed } from './history/[id]/failed/route';
import { POST as grab } from './queue/[id]/grab/route';
import { DELETE as bulkRemove } from './queue/route';

const user = { id: 'user-1', username: 'owner' };
const denied = (status: number) => ({ ok: false, response: NextResponse.json({ error: 'no' }, { status }) });

function request(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user, session: {} });
  mocks.runWithOperationAudit.mockImplementation(async (_input, op: () => Promise<unknown>) => op());
  mocks.listConnections.mockImplementation(async (type: string) => (
    type === 'SONARR' ? [{ id: 'son-1' }, { id: 'son-2' }] : type === 'RADARR' ? [{ id: 'rad-1' }] : [{ id: 'lid-1' }]
  ));
  mocks.getSonarrClient.mockResolvedValue(mocks.sonarr);
  mocks.getRadarrClient.mockResolvedValue(mocks.radarr);
  mocks.getLidarrClient.mockResolvedValue(mocks.lidarr);
  // The re-read after a bulk removal: an empty queue, so every id was removed.
  mocks.fetchAllQueueRecords.mockResolvedValue({ records: [], totalRecords: 0 });
  for (const client of [mocks.sonarr, mocks.radarr, mocks.lidarr]) {
    client.markHistoryFailed.mockResolvedValue(undefined);
    client.grabQueueItem.mockResolvedValue(undefined);
    client.deleteQueueBulk.mockResolvedValue(undefined);
  }
});

// Every action shares the gate and the instance rules.
const actions = [
  ['POST /api/activity/history/[id]/failed', (body: unknown) => markFailed(request('POST', '/api/activity/history/41/failed', body), idParams('41'))],
  ['POST /api/activity/queue/[id]/grab', (body: unknown) => grab(request('POST', '/api/activity/queue/7/grab', body), idParams('7'))],
  ['DELETE /api/activity/queue', (body: unknown) => bulkRemove(request('DELETE', '/api/activity/queue', { ids: [7], ...(body as object) }))],
] as const;

describe.each(actions)('%s', (_name, call) => {
  it.each([401, 403])('returns %s without activity.manage and calls nothing upstream', async (status) => {
    mocks.requireUserCapability.mockResolvedValueOnce(denied(status));
    expect((await call({ source: 'sonarr', instanceId: 'son-1' })).status).toBe(status);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('activity.manage');
    expect(mocks.getSonarrClient).not.toHaveBeenCalled();
  });

  it('needs an instance of that service and never falls back to the default', async () => {
    for (const body of [
      { source: 'sonarr' },
      { source: 'sonarr', instanceId: '' },
      { source: 'sonarr', instanceId: 'rad-1' },
      { source: 'sonarr', instanceId: 'missing' },
      { source: 'prowlarr', instanceId: 'son-1' },
    ]) {
      expect((await call(body)).status).toBe(400);
    }
    expect(mocks.getSonarrClient).not.toHaveBeenCalled();
    expect(mocks.runWithOperationAudit).not.toHaveBeenCalled();
    expect(mocks.recordOperationAudit).not.toHaveBeenCalled();
  });

  it('acts on the named instance', async () => {
    expect((await call({ source: 'sonarr', instanceId: 'son-2' })).status).toBe(200);
    expect(mocks.getSonarrClient).toHaveBeenCalledWith('son-2');
    expect(mocks.bumpQueueCacheVersion).toHaveBeenCalled();
  });
});

describe('POST /api/activity/history/[id]/failed', () => {
  it('marks the event failed and audits it as MARK_FAILED', async () => {
    const res = await markFailed(
      request('POST', '/api/activity/history/41/failed', { source: 'lidarr', instanceId: 'lid-1' }),
      idParams('41'),
    );
    expect(res.status).toBe(200);
    expect(mocks.lidarr.markHistoryFailed).toHaveBeenCalledWith(41);
    expect(mocks.runWithOperationAudit).toHaveBeenCalledWith(expect.objectContaining({
      user,
      service: 'LIDARR',
      instanceId: 'lid-1',
      operation: 'MARK_FAILED',
      targetType: 'history',
      targetId: 41,
      itemCount: 1,
      details: { source: 'lidarr', historyId: 41 },
    }), expect.any(Function));
  });

  it('rejects a non-numeric id', async () => {
    const res = await markFailed(
      request('POST', '/api/activity/history/x/failed', { source: 'sonarr', instanceId: 'son-1' }),
      idParams('x'),
    );
    expect(res.status).toBe(400);
    expect(mocks.sonarr.markHistoryFailed).not.toHaveBeenCalled();
  });

  it('forwards any numeric history id: the *arrs have no get-by-id to check its event type', async () => {
    // The UI offers the action only on grabs and imports; upstream decides what a
    // "failed" mark means for any other event.
    const res = await markFailed(
      request('POST', '/api/activity/history/987654/failed', { source: 'sonarr', instanceId: 'son-1' }),
      idParams('987654'),
    );
    expect(res.status).toBe(200);
    expect(mocks.sonarr.markHistoryFailed).toHaveBeenCalledWith(987654);
  });

  it('reports an upstream failure without its detail', async () => {
    mocks.sonarr.markHistoryFailed.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.2:8989'));
    const res = await markFailed(
      request('POST', '/api/activity/history/41/failed', { source: 'sonarr', instanceId: 'son-1' }),
      idParams('41'),
    );
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('10.0.0.2');
  });
});

describe('POST /api/activity/queue/[id]/grab', () => {
  it('grabs the pending release on its instance', async () => {
    const res = await grab(
      request('POST', '/api/activity/queue/7/grab', { source: 'radarr', instanceId: 'rad-1' }),
      idParams('7'),
    );
    expect(res.status).toBe(200);
    expect(mocks.radarr.grabQueueItem).toHaveBeenCalledWith(7);
  });

  it('rejects an id beyond the *arrs\' int range and a body that is not an object', async () => {
    expect((await grab(request('POST', '/api/activity/queue/2147483648/grab', { source: 'radarr', instanceId: 'rad-1' }), idParams('2147483648'))).status).toBe(400);
    expect((await grab(request('POST', '/api/activity/queue/7/grab', ['radarr']), idParams('7'))).status).toBe(400);
    expect(mocks.radarr.grabQueueItem).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric id', async () => {
    const res = await grab(request('POST', '/api/activity/queue/1e3/grab', { source: 'radarr', instanceId: 'rad-1' }), idParams('1e3'));
    expect(res.status).toBe(400);
    expect(mocks.radarr.grabQueueItem).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/activity/queue', () => {
  it('removes the ids once with the chosen options and audits one REMOVE_QUEUE row', async () => {
    const res = await bulkRemove(request('DELETE', '/api/activity/queue', {
      source: 'sonarr',
      instanceId: 'son-1',
      ids: [3, 4, 3],
      removeFromClient: true,
      blocklist: true,
    }));
    expect(res.status).toBe(200);
    const options = { removeFromClient: true, blocklist: true, skipRedownload: false, changeCategory: false };
    expect(mocks.sonarr.deleteQueueBulk).toHaveBeenCalledWith([3, 4], options);
    // The re-read sees unmatched (unknown) items too: they can be selected and removed.
    expect(mocks.fetchAllQueueRecords).toHaveBeenCalledWith(mocks.sonarr, true);
    expect(mocks.recordOperationAudit).toHaveBeenCalledTimes(1);
    expect(mocks.recordOperationAudit).toHaveBeenCalledWith(expect.objectContaining({
      user,
      service: 'SONARR',
      instanceId: 'son-1',
      operation: 'REMOVE_QUEUE',
      targetType: 'queue',
      targetId: null,
      itemCount: 2,
      filesDeleted: true,
      success: true,
      details: { source: 'sonarr', queueIds: [3, 4], ...options, removedIds: [3, 4], remainingIds: [] },
    }));
  });

  it('counts only what the queue no longer lists when upstream leaves an id in place', async () => {
    mocks.fetchAllQueueRecords.mockResolvedValueOnce({ records: [{ id: 4 }, { id: 99 }], totalRecords: 2 });
    const res = await bulkRemove(request('DELETE', '/api/activity/queue', { source: 'lidarr', instanceId: 'lid-1', ids: [3, 4] }));
    expect(res.status).toBe(200);
    expect(mocks.fetchAllQueueRecords).toHaveBeenCalledWith(mocks.lidarr, false);
    expect(mocks.recordOperationAudit).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      itemCount: 1,
      details: expect.objectContaining({ removedIds: [3], remainingIds: [4] }),
    }));
  });

  it('rejects bad ids and non-boolean options', async () => {
    for (const body of [
      { ids: [] },
      { ids: 'all' },
      { ids: [1.5] },
      { ids: [-1] },
      { ids: [2_147_483_648] },
      { ids: Array.from({ length: 1001 }, (_, i) => i) },
      { ids: [1], removeFromClient: 'true' },
    ]) {
      const res = await bulkRemove(request('DELETE', '/api/activity/queue', { source: 'sonarr', instanceId: 'son-1', ...body }));
      expect(res.status).toBe(400);
    }
    expect(mocks.sonarr.deleteQueueBulk).not.toHaveBeenCalled();
  });

  it('records what a failed removal did remove, answers 500 and still drops the cached queue', async () => {
    mocks.sonarr.deleteQueueBulk.mockRejectedValueOnce(new Error('boom'));
    mocks.fetchAllQueueRecords.mockResolvedValueOnce({ records: [{ id: 5 }], totalRecords: 1 });
    const res = await bulkRemove(request('DELETE', '/api/activity/queue', { source: 'sonarr', instanceId: 'son-1', ids: [3, 4, 5] }));
    expect(res.status).toBe(500);
    // Upstream removes item by item, so a failure may follow some removals.
    expect(mocks.bumpQueueCacheVersion).toHaveBeenCalled();
    expect(mocks.recordOperationAudit).toHaveBeenCalledTimes(1);
    expect(mocks.recordOperationAudit).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errorMessage: 'boom',
      itemCount: 2,
      filesDeleted: false,
      details: expect.objectContaining({ queueIds: [3, 4, 5], removedIds: [3, 4], remainingIds: [5] }),
    }));
  });

  it('records the outcome as unknown when the queue cannot be read again', async () => {
    mocks.sonarr.deleteQueueBulk.mockRejectedValueOnce(new Error('boom'));
    mocks.fetchAllQueueRecords.mockRejectedValueOnce(new Error('timeout'));
    const res = await bulkRemove(request('DELETE', '/api/activity/queue', { source: 'sonarr', instanceId: 'son-1', ids: [3] }));
    expect(res.status).toBe(500);
    const [[row]] = mocks.recordOperationAudit.mock.calls;
    expect(row).toMatchObject({ success: false, targetId: 3, itemCount: 1, details: { queueIds: [3], outcome: 'partial-unknown' } });
    expect(row.details).not.toHaveProperty('removedIds');
    expect(mocks.bumpQueueCacheVersion).toHaveBeenCalled();
  });

  it('gives up on a re-read that hangs and records the outcome as unknown', async () => {
    vi.useFakeTimers();
    try {
      mocks.fetchAllQueueRecords.mockReturnValueOnce(new Promise(() => {}));
      const pending = bulkRemove(request('DELETE', '/api/activity/queue', { source: 'sonarr', instanceId: 'son-1', ids: [3] }));
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await pending).status).toBe(200);
      expect(mocks.recordOperationAudit).toHaveBeenCalledWith(expect.objectContaining({
        details: expect.objectContaining({ outcome: 'partial-unknown' }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a capped re-read as unknown, not as removed', async () => {
    mocks.fetchAllQueueRecords.mockResolvedValueOnce({ records: [], totalRecords: 20_000 });
    const res = await bulkRemove(request('DELETE', '/api/activity/queue', { source: 'radarr', instanceId: 'rad-1', ids: [3, 4] }));
    expect(res.status).toBe(200);
    expect(mocks.recordOperationAudit).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      itemCount: 2,
      details: expect.objectContaining({ outcome: 'partial-unknown' }),
    }));
  });
});
