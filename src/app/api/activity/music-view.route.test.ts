import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Lidarr's downloads, history, wanted albums and blocklist are music: Activity
// lists them only for a viewer with music.view, as /music and the dashboard's
// Recently added do. Everyone else sees Sonarr and Radarr exactly as before.

const mocks = vi.hoisted(() => ({
  user: {} as Record<string, unknown>,
  getQueueCached: vi.fn(),
  getQueueNeedingImportCached: vi.fn(),
  getLidarrClient: vi.fn(),
  getLidarrClients: vi.fn(),
  listConnections: vi.fn(),
  runWithOperationAudit: vi.fn(),
  sonarr: {
    getHistory: vi.fn(), getWantedMissing: vi.fn(), getCutoffUnmet: vi.fn(), getBlocklist: vi.fn(), deleteQueueItem: vi.fn(),
  },
  lidarr: {
    getHistory: vi.fn(), getWantedMissing: vi.fn(), getCutoffUnmet: vi.fn(), getBlocklist: vi.fn(), deleteQueueItem: vi.fn(),
    deleteBlocklistItem: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: vi.fn(async () => ({ ok: true, user: mocks.user, session: {} })),
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/activity-queue', () => ({
  getQueueCached: mocks.getQueueCached,
  getQueueNeedingImportCached: mocks.getQueueNeedingImportCached,
  bumpQueueCacheVersion: vi.fn(),
  fetchAllQueueRecords: vi.fn(),
}));
vi.mock('@/lib/arr-instances', () => ({ listConnections: mocks.listConnections, resolveConnection: vi.fn() }));
vi.mock('@/lib/file-audit', () => ({ runWithOperationAudit: mocks.runWithOperationAudit, recordOperationAudit: vi.fn() }));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClient: async () => mocks.sonarr,
  getRadarrClient: vi.fn(),
  getLidarrClient: mocks.getLidarrClient,
  getSonarrClients: async () => [{ connection: { id: 'son-1', label: 'Sonarr' }, client: mocks.sonarr }],
  getRadarrClients: async () => [],
  getLidarrClients: mocks.getLidarrClients,
}));

import { GET as getQueue } from './queue/route';
import { DELETE as removeQueueItem } from './queue/[id]/route';
import { GET as getHistory } from './history/route';
import { GET as getWanted } from './wanted/route';
import { DELETE as removeBlocklist, GET as getBlocklist } from './blocklist/route';

const ADMIN = { id: 'admin', role: 'admin', template: 'admin', permissions: {} };
const MEMBER = { id: 'member', role: 'member', template: 'member', permissions: {} };
const NO_MUSIC = { id: 'no-music', role: 'member', template: 'member', permissions: { 'music.view': false } };

const get = (path: string) => new NextRequest(`http://localhost${path}`);
const page = <T,>(records: T[]) => ({ page: 1, pageSize: records.length, totalRecords: records.length, records });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLidarrClients.mockResolvedValue([{ connection: { id: 'lid-1', label: 'Lidarr' }, client: mocks.lidarr }]);
  mocks.getLidarrClient.mockResolvedValue(mocks.lidarr);
  mocks.listConnections.mockImplementation(async (type: string) => (type === 'LIDARR' ? [{ id: 'lid-1' }] : [{ id: 'son-1' }]));
  mocks.runWithOperationAudit.mockImplementation(async (_input, op: () => Promise<unknown>) => op());
  mocks.getQueueCached.mockResolvedValue({ records: [], totalRecords: 0 });
  mocks.getQueueNeedingImportCached.mockResolvedValue({ records: [], totalRecords: 0 });
  mocks.sonarr.getHistory.mockResolvedValue({ records: [{ id: 1, eventType: 'grabbed', date: '2026-11-02T00:00:00Z' }], totalRecords: 1 });
  mocks.lidarr.getHistory.mockResolvedValue({ records: [{ id: 2, eventType: 'grabbed', date: '2026-11-03T00:00:00Z' }], totalRecords: 1 });
  mocks.sonarr.getWantedMissing.mockResolvedValue(page([{ id: 11 }]));
  mocks.sonarr.getCutoffUnmet.mockResolvedValue(page([]));
  mocks.lidarr.getWantedMissing.mockResolvedValue(page([{ id: 21, artistId: 3 }, { id: 22, artistId: 3 }]));
  mocks.lidarr.getCutoffUnmet.mockResolvedValue(page([{ id: 23, artistId: 3 }]));
  mocks.sonarr.getBlocklist.mockResolvedValue(page([{ id: 31, sourceTitle: 'Show', date: '2026-11-01T00:00:00Z' }]));
  mocks.lidarr.getBlocklist.mockResolvedValue(page([{ id: 41, sourceTitle: 'Album', date: '2026-11-02T00:00:00Z' }]));
});

describe.each([
  ['an admin', ADMIN, true],
  ['a member with music.view', MEMBER, true],
  ['a member without music.view', NO_MUSIC, false],
] as const)('Activity for %s', (_label, user, seesMusic) => {
  beforeEach(() => { mocks.user = user; });

  it(seesMusic ? 'reads the queue with Lidarr' : 'reads the queue without Lidarr', async () => {
    await getQueue(get('/api/activity/queue?page=1&pageSize=50'));
    await getQueue(get('/api/activity/queue?view=needs-import'));
    expect(mocks.getQueueCached).toHaveBeenCalledWith(1, 50, { includeLidarr: seesMusic });
    expect(mocks.getQueueNeedingImportCached).toHaveBeenCalledWith({ includeLidarr: seesMusic });
  });

  it(seesMusic ? 'lists Lidarr history' : 'lists no Lidarr history, even when asked for it', async () => {
    const all = await (await getHistory(get('/api/activity/history'))).json();
    expect(all.records.map((r: { source: string }) => r.source)).toEqual(seesMusic ? ['lidarr', 'sonarr'] : ['sonarr']);
    expect(all.totalRecords).toBe(seesMusic ? 2 : 1);

    const lidarrOnly = await (await getHistory(get('/api/activity/history?source=lidarr'))).json();
    expect(lidarrOnly.records).toHaveLength(seesMusic ? 1 : 0);
    expect(lidarrOnly.totalRecords).toBe(seesMusic ? 1 : 0);
    if (!seesMusic) expect(mocks.lidarr.getHistory).not.toHaveBeenCalled();
  });

  it(seesMusic ? 'counts and lists wanted albums' : 'counts and lists no wanted albums', async () => {
    expect(await (await getWanted(get('/api/activity/wanted'))).json())
      .toEqual(seesMusic ? { missingTotal: 3, cutoffTotal: 1 } : { missingTotal: 1, cutoffTotal: 0 });

    const missing = await (await getWanted(get('/api/activity/wanted?type=missing&sources=lidarr'))).json();
    expect(missing.totalRecords).toBe(seesMusic ? 2 : 0);
    expect(missing.records).toHaveLength(seesMusic ? 2 : 0);
    if (!seesMusic) expect(mocks.lidarr.getWantedMissing).not.toHaveBeenCalled();
  });

  it(seesMusic ? 'lists the Lidarr blocklist' : 'lists no Lidarr blocklist entries', async () => {
    const body = await (await getBlocklist(get('/api/activity/blocklist'))).json();
    expect(body.records.map((r: { source: string }) => r.source)).toEqual(seesMusic ? ['lidarr', 'sonarr'] : ['sonarr']);
    expect(body.totalRecords).toBe(seesMusic ? 2 : 1);
    expect(body.partial).toBe(false);
  });

  it(seesMusic ? 'may remove a Lidarr queue item and blocklist entry' : 'may not remove a Lidarr queue item or blocklist entry', async () => {
    const removed = await removeQueueItem(
      new NextRequest('http://localhost/api/activity/queue/5?source=lidarr&instanceId=lid-1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: '5' }) },
    );
    const unblocked = await removeBlocklist(new NextRequest('http://localhost/api/activity/blocklist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'lidarr', instanceId: 'lid-1', ids: [41] }),
    }));
    expect(removed.status).toBe(seesMusic ? 200 : 403);
    expect(unblocked.status).toBe(seesMusic ? 200 : 403);
    expect(mocks.lidarr.deleteQueueItem).toHaveBeenCalledTimes(seesMusic ? 1 : 0);
    expect(mocks.lidarr.deleteBlocklistItem).toHaveBeenCalledTimes(seesMusic ? 1 : 0);
    expect(mocks.runWithOperationAudit).toHaveBeenCalledTimes(seesMusic ? 2 : 0);
  });
});
