import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  runWithOperationAudit: vi.fn(),
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
vi.mock('@/lib/file-audit', () => ({ runWithOperationAudit: mocks.runWithOperationAudit }));
vi.mock('@/lib/activity-queue', () => ({
  bumpQueueCacheVersion: mocks.bumpQueueCacheVersion,
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
      idParams('-1'),
    );
    expect(res.status).toBe(400);
    expect(mocks.sonarr.markHistoryFailed).not.toHaveBeenCalled();
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
    expect(mocks.runWithOperationAudit).toHaveBeenCalledTimes(1);
    expect(mocks.runWithOperationAudit).toHaveBeenCalledWith(expect.objectContaining({
      user,
      service: 'SONARR',
      instanceId: 'son-1',
      operation: 'REMOVE_QUEUE',
      targetType: 'queue',
      targetId: null,
      itemCount: 2,
      filesDeleted: true,
      details: { source: 'sonarr', queueIds: [3, 4], ...options },
    }), expect.any(Function));
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

  it('records a failed upstream removal, answers 500 and still drops the cached queue', async () => {
    mocks.sonarr.deleteQueueBulk.mockRejectedValueOnce(new Error('boom'));
    const res = await bulkRemove(request('DELETE', '/api/activity/queue', { source: 'sonarr', instanceId: 'son-1', ids: [3] }));
    expect(res.status).toBe(500);
    // Upstream removes item by item, so a failure may follow some removals.
    expect(mocks.bumpQueueCacheVersion).toHaveBeenCalled();
    expect(mocks.runWithOperationAudit).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 3, filesDeleted: false }),
      expect.any(Function),
    );
  });
});
