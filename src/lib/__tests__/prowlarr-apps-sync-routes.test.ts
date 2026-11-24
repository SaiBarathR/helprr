import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// Apps tab (PRO-14), Add to Prowlarr (PRO-06), Stats filters (PRO-11) and
// History order (PRO-09): who may call each route, what reaches Prowlarr, and
// that no arr API key or app settings come back.

const SECRET = 'arr-api-key-0123456789abcdef';

const mocks = vi.hoisted(() => ({
  prowlarr: {
    getTags: vi.fn(),
    bulkEditApplications: vi.fn(),
    getApplication: vi.fn(),
    resaveApplication: vi.fn(),
    getApplications: vi.fn(),
    getApplicationTemplates: vi.fn(),
    testNewApplication: vi.fn(),
    addApplication: vi.fn(),
    getIndexerStats: vi.fn(),
    getHistory: vi.fn(),
    sendCommand: vi.fn(),
  },
  requireUserCapability: vi.fn(),
  requireAdmin: vi.fn(),
  findFirst: vi.fn(),
  recordSecurityEvent: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability, requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/service-helpers', () => ({ getProwlarrClient: vi.fn(async () => mocks.prowlarr) }));
vi.mock('@/lib/db', () => ({ prisma: { serviceConnection: { findFirst: mocks.findFirst } } }));
vi.mock('@/lib/security-audit', () => ({
  recordSecurityEvent: mocks.recordSecurityEvent,
  serviceTargetLabel: (type: string, label: string) => `${type} · ${label}`,
}));

import { PUT as bulkPut } from '@/app/api/prowlarr/applications/bulk/route';
import { POST as syncPost } from '@/app/api/prowlarr/applications/[id]/sync/route';
import { GET as suggestGet, POST as addPost } from '@/app/api/prowlarr/applications/from-connection/route';
import { GET as statsGet } from '@/app/api/prowlarr/stats/route';
import { GET as historyGet } from '@/app/api/prowlarr/history/route';
import { POST as commandPost } from '@/app/api/prowlarr/command/route';

const forbidden = () => ({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
const json = (path: string, method: string, body: unknown) => new NextRequest(`http://helprr.test${path}`, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const bulk = (body: unknown) => bulkPut(json('/api/prowlarr/applications/bulk', 'PUT', body));
const sync = (id: string) => syncPost(
  new NextRequest(`http://helprr.test/api/prowlarr/applications/${id}/sync`, { method: 'POST' }),
  { params: Promise.resolve({ id }) },
);
const add = (body: unknown) => addPost(json('/api/prowlarr/applications/from-connection', 'POST', body));

const SONARR_TEMPLATE = {
  implementation: 'Sonarr',
  implementationName: 'Sonarr',
  configContract: 'SonarrSettings',
  fields: [
    { name: 'prowlarrUrl', value: 'http://localhost:9696' },
    { name: 'baseUrl', value: 'http://localhost:8989' },
    { name: 'apiKey' },
    { name: 'syncCategories', value: [5000, 5010] },
    { name: 'animeSyncCategories', value: [5070] },
  ],
};
const EXISTING_APP = {
  id: 2,
  name: 'Sonarr',
  implementation: 'Sonarr',
  implementationName: 'Sonarr',
  syncLevel: 'fullSync',
  enable: true,
  tags: [],
  fields: [
    { name: 'prowlarrUrl', value: 'http://prowlarr:9696' },
    { name: 'baseUrl', value: 'http://sonarr:8989' },
    { name: 'apiKey', value: '********' },
  ],
};
const ADD_BODY = {
  connectionId: 'conn-anime',
  name: 'sonarr-anime',
  baseUrl: 'http://192.168.0.124:8990/',
  prowlarrUrl: 'http://prowlarr:9696',
  syncLevel: 'addOnly',
};

let logged: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  logged = [];
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')); });
  }
  const admin = { ok: true, user: { id: 'u1', username: 'admin', role: 'admin' }, session: {} };
  mocks.requireUserCapability.mockResolvedValue(admin);
  mocks.requireAdmin.mockResolvedValue(admin);
  mocks.prowlarr.getTags.mockResolvedValue([{ id: 1, label: 'anime' }, { id: 2, label: 'hd' }]);
  mocks.prowlarr.getApplications.mockResolvedValue([EXISTING_APP]);
  mocks.prowlarr.getApplicationTemplates.mockResolvedValue([SONARR_TEMPLATE]);
  mocks.prowlarr.addApplication.mockResolvedValue({ id: 9, name: 'sonarr-anime' });
  mocks.prowlarr.getIndexerStats.mockResolvedValue({ indexers: [], userAgents: [], hosts: [] });
  mocks.prowlarr.getHistory.mockResolvedValue({ records: [], totalRecords: 0 });
  mocks.prowlarr.sendCommand.mockResolvedValue({ id: 1, name: 'ApplicationIndexerSync' });
  mocks.findFirst.mockImplementation(async ({ where }: { where: { type?: unknown; id?: string } }) => {
    if (where.type === 'PROWLARR') return { id: 'prowlarr-1', url: 'http://192.168.0.124:9696/', label: 'Prowlarr' };
    if (where.id === 'conn-anime') {
      return { id: 'conn-anime', type: 'SONARR', url: 'http://192.168.0.124:8990', apiKey: SECRET, label: 'sonarr-anime' };
    }
    return null;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PUT /api/prowlarr/applications/bulk', () => {
  it('needs prowlarr.manage', async () => {
    mocks.requireUserCapability.mockResolvedValue(forbidden());
    expect((await bulk({ ids: [1], syncLevel: 'disabled' })).status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('prowlarr.manage');
    expect(mocks.prowlarr.bulkEditApplications).not.toHaveBeenCalled();
  });

  it('sends only the ids and the changed properties, and answers with no app in it', async () => {
    mocks.prowlarr.bulkEditApplications.mockResolvedValue(undefined);
    const res = await bulk({ ids: [3, 3], syncLevel: 'addOnly' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.prowlarr.bulkEditApplications).toHaveBeenCalledWith({ ids: [3], syncLevel: 'addOnly' });
  });

  it('sends a tag change with how to apply it, once the tag is known', async () => {
    await bulk({ ids: [3], tags: [1], applyTags: 'add' });
    expect(mocks.prowlarr.bulkEditApplications).toHaveBeenCalledWith({ ids: [3], tags: [1], applyTags: 'add' });
  });

  it.each([
    [{ ids: [3], fields: [{ name: 'apiKey', value: 'x' }] }, 'Unsupported field: fields'],
    [{ ids: [3], syncLevel: 'everything' }, 'syncLevel must be disabled, addOnly or fullSync'],
    [{ ids: [3], tags: [1] }, 'tags and applyTags go together'],
    [{ ids: [3], tags: [1], applyTags: 'merge' }, 'applyTags must be add, remove or replace'],
    [{ ids: [] , syncLevel: 'disabled' }, 'ids must list 1 to 50 apps'],
    [{ ids: [0], syncLevel: 'disabled' }, 'ids must be positive whole numbers'],
    [{ ids: [3] }, 'Nothing to change'],
  ])('refuses %j without calling Prowlarr', async (body, error) => {
    const res = await bulk(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    expect(mocks.prowlarr.bulkEditApplications).not.toHaveBeenCalled();
  });

  it('refuses a tag Prowlarr no longer has', async () => {
    const res = await bulk({ ids: [3], tags: [7], applyTags: 'add' });
    expect(res.status).toBe(400);
    expect(mocks.prowlarr.bulkEditApplications).not.toHaveBeenCalled();
  });
});

describe('POST /api/prowlarr/applications/[id]/sync', () => {
  it('needs prowlarr.manage', async () => {
    mocks.requireUserCapability.mockResolvedValue(forbidden());
    expect((await sync('2')).status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('prowlarr.manage');
    expect(mocks.prowlarr.getApplication).not.toHaveBeenCalled();
  });

  it('saves the app back as Prowlarr gave it, and answers with none of it', async () => {
    mocks.prowlarr.getApplication.mockResolvedValue(EXISTING_APP);
    const res = await sync('2');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify({ ok: true }));
    expect(mocks.prowlarr.getApplication).toHaveBeenCalledWith(2);
    expect(mocks.prowlarr.resaveApplication).toHaveBeenCalledWith(EXISTING_APP);
  });

  it('says sync is off instead of saving an app Prowlarr would not sync', async () => {
    mocks.prowlarr.getApplication.mockResolvedValue({ ...EXISTING_APP, syncLevel: 'disabled' });
    const res = await sync('2');
    expect(res.status).toBe(409);
    expect(mocks.prowlarr.resaveApplication).not.toHaveBeenCalled();
  });

  it('answers a failed sync with a fixed message', async () => {
    mocks.prowlarr.getApplication.mockResolvedValue(EXISTING_APP);
    mocks.prowlarr.resaveApplication.mockRejectedValue(new Error('Unable to connect to http://sonarr:8989'));
    const res = await sync('2');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Sync failed' });
  });

  it.each(['0', 'abc', '12345678901'])('refuses the id %s', async (id) => {
    expect((await sync(id)).status).toBe(400);
    expect(mocks.prowlarr.getApplication).not.toHaveBeenCalled();
  });
});

describe('GET /api/prowlarr/applications/from-connection', () => {
  const suggest = (connectionId: string) => suggestGet(
    new NextRequest(`http://helprr.test/api/prowlarr/applications/from-connection?connectionId=${connectionId}`),
  );

  it('is for an admin only', async () => {
    mocks.requireAdmin.mockResolvedValue(forbidden());
    expect((await suggest('conn-anime')).status).toBe(403);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('guesses both addresses, from Helprr and from the other apps, and never sends the key', async () => {
    const res = await suggest('conn-anime');
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text)).toEqual({
      implementation: 'Sonarr',
      name: 'sonarr-anime',
      baseUrl: 'http://192.168.0.124:8990',
      prowlarrUrl: 'http://prowlarr:9696',
    });
  });

  it('falls back to the address Helprr uses for Prowlarr, and renames a taken name', async () => {
    mocks.prowlarr.getApplications.mockResolvedValue([{ ...EXISTING_APP, name: 'SONARR-ANIME', fields: [] }]);
    expect(await (await suggest('conn-anime')).json()).toMatchObject({
      name: 'sonarr-anime (Helprr)',
      prowlarrUrl: 'http://192.168.0.124:9696',
    });
  });

  it('answers 404 for a connection that is gone or is not an arr', async () => {
    expect((await suggest('conn-other')).status).toBe(404);
  });
});

describe('POST /api/prowlarr/applications/from-connection', () => {
  it('is for an admin only', async () => {
    mocks.requireAdmin.mockResolvedValue(forbidden());
    expect((await add(ADD_BODY)).status).toBe(403);
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.prowlarr.addApplication).not.toHaveBeenCalled();
  });

  it('fills Prowlarr’s own form, tests it, adds it, and answers with only the id and name', async () => {
    const res = await add(ADD_BODY);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ id: 9, name: 'sonarr-anime' });
    expect(text).not.toContain(SECRET);

    const expected = {
      name: 'sonarr-anime',
      implementation: 'Sonarr',
      implementationName: 'Sonarr',
      configContract: 'SonarrSettings',
      syncLevel: 'addOnly',
      tags: [],
      fields: [
        { name: 'prowlarrUrl', value: 'http://prowlarr:9696' },
        { name: 'baseUrl', value: 'http://192.168.0.124:8990' },
        { name: 'apiKey', value: SECRET },
        { name: 'syncCategories', value: [5000, 5010] },
        { name: 'animeSyncCategories', value: [5070] },
      ],
    };
    expect(mocks.prowlarr.testNewApplication).toHaveBeenCalledWith(expected);
    expect(mocks.prowlarr.addApplication).toHaveBeenCalledWith(expected);
    expect(mocks.prowlarr.testNewApplication.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.prowlarr.addApplication.mock.invocationCallOrder[0]);
  });

  it('records who added it, without the key, and logs no key', async () => {
    await add(ADD_BODY);
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actor: expect.objectContaining({ id: 'u1' }),
      action: 'SERVICE_UPDATED',
      targetType: 'service',
      targetId: 'prowlarr-1',
    }));
    expect(JSON.stringify(mocks.recordSecurityEvent.mock.calls)).not.toContain(SECRET);
    expect(logged.join('\n')).not.toContain(SECRET);
  });

  it('only tests when asked to', async () => {
    const res = await add({ ...ADD_BODY, testOnly: true });
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.prowlarr.testNewApplication).toHaveBeenCalled();
    expect(mocks.prowlarr.addApplication).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });

  it('passes on why Prowlarr refused the test, with the key taken out, and adds nothing', async () => {
    mocks.prowlarr.testNewApplication.mockRejectedValue(new Error(`Unable to connect to Sonarr with key ${SECRET}`));
    const res = await add(ADD_BODY);
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text).error).toContain('Unable to connect to Sonarr');
    expect(logged.join('\n')).not.toContain(SECRET);
    expect(mocks.prowlarr.addApplication).not.toHaveBeenCalled();
  });

  it('refuses an arr Prowlarr already has an app at', async () => {
    const res = await add({ ...ADD_BODY, baseUrl: 'http://sonarr:8989' });
    expect(res.status).toBe(409);
    expect(mocks.prowlarr.testNewApplication).not.toHaveBeenCalled();
  });

  it('adds nothing when Prowlarr’s form lacks a field Helprr fills', async () => {
    mocks.prowlarr.getApplicationTemplates.mockResolvedValue([{ ...SONARR_TEMPLATE, fields: SONARR_TEMPLATE.fields.slice(1) }]);
    expect((await add(ADD_BODY)).status).toBe(502);
    expect(mocks.prowlarr.testNewApplication).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...ADD_BODY, apiKey: 'chosen-by-the-browser' }, 'Unsupported field: apiKey'],
    [{ ...ADD_BODY, baseUrl: 'ftp://sonarr' }, 'baseUrl must be an http or https address'],
    [{ ...ADD_BODY, prowlarrUrl: 'http://user:pass@prowlarr:9696' }, 'prowlarrUrl must be an http or https address'],
    [{ ...ADD_BODY, name: '  ' }, 'name must be 1 to 100 characters'],
    [{ ...ADD_BODY, syncLevel: 'all' }, 'syncLevel must be disabled, addOnly or fullSync'],
    [{ ...ADD_BODY, connectionId: '../x' }, 'connectionId is required'],
  ])('refuses %j without calling Prowlarr', async (body, error) => {
    const res = await add(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    expect(mocks.prowlarr.testNewApplication).not.toHaveBeenCalled();
  });

  it('answers 404 for a connection that is gone or is not an arr', async () => {
    expect((await add({ ...ADD_BODY, connectionId: 'conn-other' })).status).toBe(404);
    expect(mocks.prowlarr.getApplications).not.toHaveBeenCalled();
  });
});

describe('GET /api/prowlarr/stats filters', () => {
  const stats = (query: string) => statsGet(new NextRequest(`http://helprr.test/api/prowlarr/stats${query}`));

  it('passes on the end date, indexers, tags and protocols as Helprr writes them', async () => {
    const res = await stats('?startDate=2026-11-01T00:00:00Z&endDate=2026-11-10T23:59:59.999Z&indexers=4,2,4&tags=1&protocols=torrent');
    expect(res.status).toBe(200);
    expect(mocks.prowlarr.getIndexerStats).toHaveBeenCalledWith({
      startDate: '2026-11-01T00:00:00.000Z',
      endDate: '2026-11-10T23:59:59.999Z',
      indexers: '4,2',
      tags: '1',
      protocols: 'torrent',
    });
  });

  it.each([
    '?endDate=yesterday',
    '?indexers=1,x',
    '?indexers=0',
    '?tags=',
    '?protocols=torrent,ftp',
  ])('refuses %s without calling Prowlarr', async (query) => {
    expect((await stats(query)).status).toBe(400);
    expect(mocks.prowlarr.getIndexerStats).not.toHaveBeenCalled();
  });

  it('refuses a tag Prowlarr no longer has, which would fail the whole request there', async () => {
    const res = await stats('?tags=1,7');
    expect(res.status).toBe(400);
    expect(mocks.prowlarr.getIndexerStats).not.toHaveBeenCalled();
  });
});

describe('GET /api/prowlarr/history order', () => {
  const history = (query: string) => historyGet(new NextRequest(`http://helprr.test/api/prowlarr/history${query}`));

  it('asks for oldest first only when told to', async () => {
    await history('?sort=oldest&eventType=4');
    expect(mocks.prowlarr.getHistory).toHaveBeenLastCalledWith(expect.objectContaining({ sortDirection: 'ascending', eventType: 4 }));
    await history('?sort=sideways');
    expect(mocks.prowlarr.getHistory).toHaveBeenLastCalledWith(expect.objectContaining({ sortDirection: undefined }));
  });
});

describe('POST /api/prowlarr/command forceSync', () => {
  const command = (body: unknown) => commandPost(json('/api/prowlarr/command', 'POST', body));

  it('passes a forced sync on', async () => {
    await command({ name: 'ApplicationIndexerSync', forceSync: true });
    expect(mocks.prowlarr.sendCommand).toHaveBeenCalledWith('ApplicationIndexerSync', { forceSync: true });
  });

  it('refuses a forceSync that is not true or false', async () => {
    expect((await command({ name: 'ApplicationIndexerSync', forceSync: 'yes' })).status).toBe(400);
    expect(mocks.prowlarr.sendCommand).not.toHaveBeenCalled();
  });
});
