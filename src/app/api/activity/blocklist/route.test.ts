import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  runWithOperationAudit: vi.fn(),
  listConnections: vi.fn(),
  getSonarrClient: vi.fn(),
  getRadarrClient: vi.fn(),
  getLidarrClient: vi.fn(),
  getSonarrClients: vi.fn(),
  getRadarrClients: vi.fn(),
  getLidarrClients: vi.fn(),
  sonarr: { getBlocklist: vi.fn(), deleteBlocklistItem: vi.fn(), deleteBlocklistBulk: vi.fn() },
  radarr: { getBlocklist: vi.fn(), deleteBlocklistItem: vi.fn(), deleteBlocklistBulk: vi.fn() },
  lidarr: { getBlocklist: vi.fn(), deleteBlocklistItem: vi.fn(), deleteBlocklistBulk: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/arr-instances', () => ({ listConnections: mocks.listConnections }));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClient: mocks.getSonarrClient,
  getRadarrClient: mocks.getRadarrClient,
  getLidarrClient: mocks.getLidarrClient,
  getSonarrClients: mocks.getSonarrClients,
  getRadarrClients: mocks.getRadarrClients,
  getLidarrClients: mocks.getLidarrClients,
}));
vi.mock('@/lib/file-audit', () => ({ runWithOperationAudit: mocks.runWithOperationAudit }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { DELETE, GET } from './route';

const user = { id: 'user-1', username: 'owner' };

function request(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const entry = (id: number, date: string) => ({ id, sourceTitle: `Release.${id}`, date, protocol: 'torrent', indexer: 'Idx', message: 'Failed' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user, session: {} });
  mocks.runWithOperationAudit.mockImplementation(async (_input, op: () => Promise<unknown>) => op());
  mocks.listConnections.mockImplementation(async (type: string) => (
    type === 'SONARR' ? [{ id: 'son-1' }] : type === 'RADARR' ? [{ id: 'rad-1' }] : [{ id: 'lid-1' }]
  ));
  mocks.getSonarrClient.mockResolvedValue(mocks.sonarr);
  mocks.getRadarrClient.mockResolvedValue(mocks.radarr);
  mocks.getLidarrClient.mockResolvedValue(mocks.lidarr);
  mocks.getSonarrClients.mockResolvedValue([{ connection: { id: 'son-1', label: 'main' }, client: mocks.sonarr }]);
  mocks.getRadarrClients.mockResolvedValue([{ connection: { id: 'rad-1', label: 'main' }, client: mocks.radarr }]);
  mocks.getLidarrClients.mockResolvedValue([]);
  mocks.sonarr.getBlocklist.mockResolvedValue({ totalRecords: 2, records: [entry(1, '2026-11-04T10:00:00Z'), entry(2, '2026-11-01T10:00:00Z')] });
  mocks.radarr.getBlocklist.mockResolvedValue({ totalRecords: 1, records: [entry(7, '2026-11-03T10:00:00Z')] });
});

describe('GET /api/activity/blocklist', () => {
  it('needs activity.view', async () => {
    mocks.requireUserCapability.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await GET(request('GET', '/api/activity/blocklist'))).status).toBe(401);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('activity.view');
    expect(mocks.getSonarrClients).not.toHaveBeenCalled();
  });

  it('merges every instance newest first, tagged with its source and instance', async () => {
    const res = await GET(request('GET', '/api/activity/blocklist?page=1&pageSize=2'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await res.json();
    expect(body.records.map((r: { id: number; source: string; instanceId: string }) => [r.source, r.instanceId, r.id])).toEqual([
      ['sonarr', 'son-1', 1],
      ['radarr', 'rad-1', 7],
    ]);
    expect(body.hasMore).toBe(true);
    expect(mocks.sonarr.getBlocklist).toHaveBeenCalledWith(1, 2);
  });

  it('scopes to one instance', async () => {
    const body = await (await GET(request('GET', '/api/activity/blocklist?instanceId=rad-1'))).json();
    expect(body.records.map((r: { id: number }) => r.id)).toEqual([7]);
    expect(mocks.sonarr.getBlocklist).not.toHaveBeenCalled();
  });

  it('clamps the page size and rejects a window past the limit', async () => {
    await GET(request('GET', '/api/activity/blocklist?pageSize=5000'));
    expect(mocks.sonarr.getBlocklist).toHaveBeenLastCalledWith(1, 100);
    expect((await GET(request('GET', '/api/activity/blocklist?page=20&pageSize=100'))).status).toBe(400);
    expect(mocks.sonarr.getBlocklist).toHaveBeenCalledTimes(1);
  });

  it('reports a partial result when one instance fails, and 502 when all do', async () => {
    mocks.radarr.getBlocklist.mockRejectedValueOnce(new Error('down'));
    const body = await (await GET(request('GET', '/api/activity/blocklist'))).json();
    expect(body).toMatchObject({ partial: true, failedSources: ['radarr'] });
    mocks.sonarr.getBlocklist.mockRejectedValueOnce(new Error('down'));
    mocks.radarr.getBlocklist.mockRejectedValueOnce(new Error('down'));
    expect((await GET(request('GET', '/api/activity/blocklist'))).status).toBe(502);
  });
});

describe('DELETE /api/activity/blocklist', () => {
  it('returns 401 without a session and 403 without activity.manage, touching nothing', async () => {
    mocks.requireUserCapability.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await DELETE(request('DELETE', '/api/activity/blocklist', { source: 'sonarr', instanceId: 'son-1', ids: [1] }))).status).toBe(401);
    mocks.requireUserCapability.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    expect((await DELETE(request('DELETE', '/api/activity/blocklist', { source: 'sonarr', instanceId: 'son-1', ids: [1] }))).status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('activity.manage');
    expect(mocks.sonarr.deleteBlocklistItem).not.toHaveBeenCalled();
    expect(mocks.runWithOperationAudit).not.toHaveBeenCalled();
  });

  it.each([
    ['no body', undefined],
    ['an unknown source', { source: 'prowlarr', instanceId: 'son-1', ids: [1] }],
    ['no instanceId', { source: 'sonarr', ids: [1] }],
    ['empty ids', { source: 'sonarr', instanceId: 'son-1', ids: [] }],
    ['non-integer ids', { source: 'sonarr', instanceId: 'son-1', ids: [1.5] }],
    ['string ids', { source: 'sonarr', instanceId: 'son-1', ids: ['1'] }],
    ['negative ids', { source: 'sonarr', instanceId: 'son-1', ids: [-1] }],
    ['too many ids', { source: 'sonarr', instanceId: 'son-1', ids: Array.from({ length: 1001 }, (_, i) => i + 1) }],
    // A Radarr instance id named as Sonarr, and an id that is no instance at all.
    ['an instance of another type', { source: 'sonarr', instanceId: 'rad-1', ids: [1] }],
    ['an unknown instance', { source: 'sonarr', instanceId: 'nope', ids: [1] }],
  ])('rejects %s with 400 and calls nothing upstream', async (_label, body) => {
    const res = await DELETE(request('DELETE', '/api/activity/blocklist', body));
    expect(res.status).toBe(400);
    expect(mocks.getSonarrClient).not.toHaveBeenCalled();
    expect(mocks.runWithOperationAudit).not.toHaveBeenCalled();
  });

  it('removes one entry on the named instance and audits it under its release title from the *arr', async () => {
    const res = await DELETE(request('DELETE', '/api/activity/blocklist', {
      source: 'sonarr', instanceId: 'son-1', ids: [1],
      // A title the browser sends is never trusted.
      sourceTitle: 'Forged.Title', titles: ['Forged.Title'],
    }));
    expect(res.status).toBe(200);
    expect(mocks.getSonarrClient).toHaveBeenCalledWith('son-1');
    expect(mocks.sonarr.getBlocklist).toHaveBeenCalledWith(1, 1000);
    expect(mocks.sonarr.deleteBlocklistItem).toHaveBeenCalledWith(1);
    expect(mocks.sonarr.deleteBlocklistBulk).not.toHaveBeenCalled();
    expect(mocks.runWithOperationAudit).toHaveBeenCalledWith(expect.objectContaining({
      user,
      service: 'SONARR',
      instanceId: 'son-1',
      operation: 'REMOVE_BLOCKLIST',
      targetType: 'blocklist',
      targetId: 1,
      targetTitle: 'Release.1',
      itemCount: 1,
      details: { source: 'sonarr', ids: [1], titles: ['Release.1'] },
    }), expect.any(Function));
    expect(JSON.stringify(mocks.runWithOperationAudit.mock.calls)).not.toContain('Forged');
  });

  it('falls back to the id when the entry is not found or the lookup fails, and still removes it', async () => {
    await DELETE(request('DELETE', '/api/activity/blocklist', { source: 'sonarr', instanceId: 'son-1', ids: [4] }));
    expect(mocks.runWithOperationAudit).toHaveBeenLastCalledWith(expect.objectContaining({
      targetTitle: 'Sonarr blocklist entry #4',
      details: { source: 'sonarr', ids: [4], titles: ['#4'] },
    }), expect.any(Function));

    mocks.radarr.getBlocklist.mockRejectedValueOnce(new Error('timeout'));
    const res = await DELETE(request('DELETE', '/api/activity/blocklist', { source: 'radarr', instanceId: 'rad-1', ids: [7, 8] }));
    expect(res.status).toBe(200);
    expect(mocks.radarr.deleteBlocklistBulk).toHaveBeenCalledWith([7, 8]);
    expect(mocks.runWithOperationAudit).toHaveBeenLastCalledWith(expect.objectContaining({
      details: { source: 'radarr', ids: [7, 8], titles: ['#7', '#8'] },
    }), expect.any(Function));
  });

  it('removes several entries in one bulk call (deduplicated) and audits them as one row', async () => {
    mocks.radarr.getBlocklist.mockResolvedValue({ totalRecords: 2, records: [entry(5, '2026-11-03T10:00:00Z'), entry(3, '2026-11-02T10:00:00Z')] });
    const res = await DELETE(request('DELETE', '/api/activity/blocklist', { source: 'radarr', instanceId: 'rad-1', ids: [3, 5, 3] }));
    expect(await res.json()).toEqual({ success: true, removed: 2 });
    expect(mocks.radarr.deleteBlocklistBulk).toHaveBeenCalledWith([3, 5]);
    expect(mocks.runWithOperationAudit).toHaveBeenCalledTimes(1);
    expect(mocks.runWithOperationAudit).toHaveBeenCalledWith(expect.objectContaining({
      service: 'RADARR',
      instanceId: 'rad-1',
      operation: 'REMOVE_BLOCKLIST',
      targetId: null,
      targetTitle: '2 Radarr blocklist entries',
      itemCount: 2,
      details: { source: 'radarr', ids: [3, 5], titles: ['Release.3', 'Release.5'] },
    }), expect.any(Function));
  });

  it('removes Lidarr entries on the named Lidarr instance', async () => {
    const res = await DELETE(request('DELETE', '/api/activity/blocklist', { source: 'lidarr', instanceId: 'lid-1', ids: [8, 9] }));
    expect(res.status).toBe(200);
    expect(mocks.getLidarrClient).toHaveBeenCalledWith('lid-1');
    expect(mocks.lidarr.deleteBlocklistBulk).toHaveBeenCalledWith([8, 9]);
    expect(mocks.runWithOperationAudit).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'LIDARR', instanceId: 'lid-1', operation: 'REMOVE_BLOCKLIST' }),
      expect.any(Function),
    );
  });

  it('answers 500 without upstream detail when the *arr call fails', async () => {
    mocks.sonarr.deleteBlocklistItem.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.2:8989'));
    const res = await DELETE(request('DELETE', '/api/activity/blocklist', { source: 'sonarr', instanceId: 'son-1', ids: [4] }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('10.0.0.2');
  });
});
