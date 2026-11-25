import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { can } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';

// GET /api/{sonarr,radarr,lidarr}/qualityprofiles/[id]: the read-only profile
// sheet. Who may read it, which instance answers, and that only the allow-listed
// summary leaves the server. Real permission resolution.

const mocks = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  resolveConnection: vi.fn(),
  listConnections: vi.fn(),
  getQualityProfile: vi.fn(),
  constructed: [] as string[],
  getCachedJson: vi.fn(),
  setCachedJson: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: async (cap: Capability) => {
    if (!mocks.user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    return can(mocks.user as never, cap)
      ? { ok: true, user: mocks.user, session: {} }
      : { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  },
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/arr-instances', () => ({ resolveConnection: mocks.resolveConnection, listConnections: mocks.listConnections }));
vi.mock('@/lib/service-connection-secrets', () => ({ getConnectionHeaders: () => undefined }));
vi.mock('@/lib/cache/json-cache', () => ({ getCachedJson: mocks.getCachedJson, setCachedJson: mocks.setCachedJson }));
function fakeClient(name: string) {
  return class {
    constructor(url: string) { mocks.constructed.push(`${name}:${url}`); }
    getQualityProfile = mocks.getQualityProfile;
  };
}
vi.mock('@/lib/sonarr-client', () => ({ SonarrClient: fakeClient('sonarr') }));
vi.mock('@/lib/radarr-client', () => ({ RadarrClient: fakeClient('radarr') }));
vi.mock('@/lib/lidarr-client', () => ({ LidarrClient: fakeClient('lidarr') }));

import { GET as sonarrGET } from './route';
import { GET as radarrGET } from '@/app/api/radarr/qualityprofiles/[id]/route';
import { GET as lidarrGET } from '@/app/api/lidarr/qualityprofiles/[id]/route';

const ADMIN = { id: 'admin', role: 'admin', template: 'admin', permissions: {} };
const member = (cap: Capability, value: boolean) => ({ id: 'm', role: 'member', template: 'member', permissions: { [cap]: value } });

// A Radarr profile as it comes back, with fields that must not be passed on.
const RAW = {
  id: 4,
  name: 'HD-1080p',
  upgradeAllowed: true,
  cutoff: 7,
  minFormatScore: 0,
  cutoffFormatScore: 1000,
  minUpgradeFormatScore: 10,
  language: { id: 1, name: 'English' },
  items: [{ quality: { id: 7, name: 'Bluray-1080p', source: 'bluray', resolution: 1080 }, items: [], allowed: true }],
  formatItems: [{
    format: 3,
    name: 'Remux',
    score: 50,
    specifications: [{ name: 'secret-ish', implementation: 'ReleaseTitleSpecification', fields: [{ name: 'value', value: 'x' }] }],
  }],
  specifications: [{ name: 'should not leak' }],
};

const ROUTES = [
  { label: 'sonarr', GET: sonarrGET, type: 'SONARR', cap: 'series.view' as Capability },
  { label: 'radarr', GET: radarrGET, type: 'RADARR', cap: 'movies.view' as Capability },
  { label: 'lidarr', GET: lidarrGET, type: 'LIDARR', cap: 'music.view' as Capability },
];

function call(route: (typeof ROUTES)[number], id: string, query = '?instanceId=inst-1') {
  return route.GET(
    new NextRequest(`http://localhost/api/${route.label}/qualityprofiles/${id}${query}`),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.constructed = [];
  mocks.user = ADMIN;
  mocks.getCachedJson.mockResolvedValue(null);
  mocks.getQualityProfile.mockResolvedValue(RAW);
  // Each type has one instance, inst-1; 'other-type' is an instance of another type.
  mocks.listConnections.mockResolvedValue([{ id: 'inst-1' }]);
  mocks.resolveConnection.mockImplementation(async (type: string, instanceId?: string) => {
    // The real resolveConnection refuses an id that is not an instance of `type`.
    if (instanceId === 'other-type') throw new Error(`No ${type} instance found for id "${instanceId}".`);
    return { id: instanceId ?? 'default-conn', url: `http://${type.toLowerCase()}`, apiKey: 'k', customHeaders: null };
  });
});

describe.each(ROUTES)('GET /api/$label/qualityprofiles/[id]', (route) => {
  it(`refuses a signed-out user and a member without ${route.cap}`, async () => {
    mocks.user = null;
    expect((await call(route, '4')).status).toBe(401);
    mocks.user = member(route.cap, false);
    expect((await call(route, '4')).status).toBe(403);
    expect(mocks.resolveConnection).not.toHaveBeenCalled();
    expect(mocks.getQualityProfile).not.toHaveBeenCalled();
  });

  it(`reads the profile from the instance in the query for a member with ${route.cap}`, async () => {
    mocks.user = member(route.cap, true);
    const res = await call(route, '4');
    expect(res.status).toBe(200);
    expect(mocks.resolveConnection).toHaveBeenCalledWith(route.type, 'inst-1');
    expect(mocks.constructed).toEqual([`${route.label}:http://${route.label}`]);
    expect(mocks.getQualityProfile).toHaveBeenCalledWith(4);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=60');
    expect(res.headers.get('Vary')).toBe('Cookie');
    expect(mocks.getCachedJson).toHaveBeenCalledWith(`${route.label}-qualityprofile`, 'inst-1:4');
    expect(mocks.setCachedJson).toHaveBeenCalledWith(`${route.label}-qualityprofile`, 'inst-1:4', expect.any(Object), 120);
  });

  it('returns only the allow-listed summary: no specifications or raw fields', async () => {
    const body = await (await call(route, '4')).json();
    expect(Object.keys(body).sort()).toEqual([
      'cutoff', 'cutoffFormatScore', 'formats', 'id', 'language', 'minFormatScore',
      'minUpgradeFormatScore', 'name', 'qualities', 'upgradeAllowed',
    ]);
    expect(body.formats).toEqual([{ name: 'Remux', score: 50 }]);
    expect(body.qualities).toEqual([{ name: 'Bluray-1080p', isCutoff: true, members: [] }]);
    const text = JSON.stringify(body);
    expect(text).not.toContain('specifications');
    expect(text).not.toContain('fields');
    expect(text).not.toContain('source');
  });

  it('refuses an id that is not a positive integer before reaching the app', async () => {
    for (const id of ['0', '-1', 'abc', '4.5', '1e3', '99999999999999999999']) {
      expect((await call(route, id)).status).toBe(400);
    }
    expect(mocks.resolveConnection).not.toHaveBeenCalled();
  });

  it('answers 400 for an instance of another type, and never calls an app', async () => {
    const res = await call(route, '4', '?instanceId=other-type');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: `Unknown ${route.label[0].toUpperCase()}${route.label.slice(1)} instance` });
    expect(mocks.listConnections).toHaveBeenCalledWith(route.type);
    expect(mocks.constructed).toEqual([]);
  });

  it('answers 404 when the app has no such profile', async () => {
    mocks.getQualityProfile.mockRejectedValue(Object.assign(new Error('nf'), { isAxiosError: true, response: { status: 404 } }));
    expect((await call(route, '40')).status).toBe(404);
    expect(mocks.setCachedJson).not.toHaveBeenCalled();
  });

  it('serves a cached summary without asking the app again', async () => {
    mocks.getCachedJson.mockResolvedValue({ id: 4, name: 'Cached' });
    const body = await (await call(route, '4')).json();
    expect(body.name).toBe('Cached');
    expect(mocks.getQualityProfile).not.toHaveBeenCalled();
  });
});
