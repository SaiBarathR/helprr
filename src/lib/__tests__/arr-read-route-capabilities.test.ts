import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Capability } from '@/lib/capabilities';

// Real permission resolution (can(), member template, deltas) behind the two
// route helpers, so each case exercises the capability a route really asks for.
const mocks = vi.hoisted(() => ({
  user: null as null | { id: string; role: string; template: string; permissions: Record<string, boolean> },
  getSonarrClient: vi.fn(),
  getRadarrClient: vi.fn(),
  getLidarrClient: vi.fn(),
  listLayouts: vi.fn(),
  getActiveLayoutForUser: vi.fn(),
}));

vi.mock('@/lib/auth', async () => {
  const { can } = await import('@/lib/permissions');
  const { NextResponse: Res } = await import('next/server');
  const deny = (status: number) => ({
    ok: false as const,
    response: Res.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status }),
  });
  const gate = (caps: readonly Capability[]) => {
    const user = mocks.user;
    if (!user) return deny(401);
    if (!caps.some((cap) => can(user as never, cap))) return deny(403);
    return { ok: true as const, user, session: {} };
  };
  return {
    requireUserCapability: vi.fn(async (cap: Capability) => gate([cap])),
    requireUserAnyCapability: vi.fn(async (caps: readonly Capability[]) => gate(caps)),
  };
});
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClient: mocks.getSonarrClient,
  getRadarrClient: mocks.getRadarrClient,
  getLidarrClient: mocks.getLidarrClient,
  getTMDBClient: vi.fn(),
}));
vi.mock('@/lib/dashboard-layouts', () => ({
  seedInitialLayouts: vi.fn(async () => {}),
  listLayouts: mocks.listLayouts,
  getActiveLayoutForUser: mocks.getActiveLayoutForUser,
  layoutScopeForUser: () => ({}),
  createLayout: vi.fn(),
  ServiceError: class ServiceError extends Error {},
}));

import { requireUserAnyCapability, requireUserCapability } from '@/lib/auth';
import { GET as sonarrCredits } from '@/app/api/sonarr/[id]/credits/route';
import { GET as radarrCredit } from '@/app/api/radarr/credit/route';
import { GET as sonarrLookup } from '@/app/api/sonarr/lookup/route';
import { GET as radarrLookup } from '@/app/api/radarr/lookup/route';
import { GET as lidarrLookup } from '@/app/api/lidarr/lookup/route';
import { GET as sonarrQualityDefinitions } from '@/app/api/sonarr/qualitydefinitions/route';
import { GET as radarrQualityDefinitions } from '@/app/api/radarr/qualitydefinitions/route';
import { GET as sonarrLanguages } from '@/app/api/sonarr/languages/route';
import { GET as radarrLanguages } from '@/app/api/radarr/languages/route';
import { GET as sonarrQualityProfiles } from '@/app/api/sonarr/qualityprofiles/route';
import { GET as radarrQualityProfiles } from '@/app/api/radarr/qualityprofiles/route';
import { GET as lidarrQualityProfiles } from '@/app/api/lidarr/qualityprofiles/route';
import { GET as lidarrMetadataProfiles } from '@/app/api/lidarr/metadataprofiles/route';
import { GET as sonarrTags } from '@/app/api/sonarr/tags/route';
import { GET as radarrTags } from '@/app/api/radarr/tags/route';
import { GET as sonarrEpisodes } from '@/app/api/sonarr/[id]/episodes/route';
import { GET as layoutsList } from '@/app/api/dashboard-layouts/route';
import { GET as layoutsActive } from '@/app/api/dashboard-layouts/active/route';

type Service = 'sonarr' | 'radarr' | 'lidarr';

interface Case {
  name: string;
  /** Any one of these lets the request through. */
  anyOf: Capability[];
  service: Service | null;
  invoke: (instanceId: string) => Promise<Response>;
}

const req = (path: string, instanceId: string) =>
  new NextRequest(`http://localhost${path}${path.includes('?') ? '&' : '?'}instanceId=${instanceId}`);
const withId = (id: string) => ({ params: Promise.resolve({ id }) });

const cases: Case[] = [
  { name: 'Sonarr credits', anyOf: ['series.view'], service: 'sonarr',
    invoke: (i) => sonarrCredits(req('/api/sonarr/7/credits', i), withId('7')) },
  { name: 'Radarr credit', anyOf: ['movies.view'], service: 'radarr',
    invoke: (i) => radarrCredit(req('/api/radarr/credit?movieId=8', i)) },
  { name: 'Sonarr lookup', anyOf: ['series.add'], service: 'sonarr',
    invoke: (i) => sonarrLookup(req('/api/sonarr/lookup?term=dune', i)) },
  { name: 'Radarr lookup', anyOf: ['movies.add'], service: 'radarr',
    invoke: (i) => radarrLookup(req('/api/radarr/lookup?term=dune', i)) },
  { name: 'Lidarr lookup', anyOf: ['music.add'], service: 'lidarr',
    invoke: (i) => lidarrLookup(req('/api/lidarr/lookup?term=dune', i)) },
  { name: 'Sonarr quality definitions', anyOf: ['series.manageFiles'], service: 'sonarr',
    invoke: (i) => sonarrQualityDefinitions(req('/api/sonarr/qualitydefinitions', i)) },
  { name: 'Radarr quality definitions', anyOf: ['movies.manageFiles'], service: 'radarr',
    invoke: (i) => radarrQualityDefinitions(req('/api/radarr/qualitydefinitions', i)) },
  { name: 'Sonarr languages', anyOf: ['series.manageFiles'], service: 'sonarr',
    invoke: (i) => sonarrLanguages(req('/api/sonarr/languages', i)) },
  { name: 'Radarr languages', anyOf: ['movies.manageFiles'], service: 'radarr',
    invoke: (i) => radarrLanguages(req('/api/radarr/languages', i)) },
  { name: 'Sonarr quality profiles', anyOf: ['series.view', 'series.add'], service: 'sonarr',
    invoke: (i) => sonarrQualityProfiles(req('/api/sonarr/qualityprofiles', i)) },
  { name: 'Radarr quality profiles', anyOf: ['movies.view', 'movies.add'], service: 'radarr',
    invoke: (i) => radarrQualityProfiles(req('/api/radarr/qualityprofiles', i)) },
  { name: 'Lidarr quality profiles', anyOf: ['music.view', 'music.add'], service: 'lidarr',
    invoke: (i) => lidarrQualityProfiles(req('/api/lidarr/qualityprofiles', i)) },
  { name: 'Lidarr metadata profiles', anyOf: ['music.view', 'music.add'], service: 'lidarr',
    invoke: (i) => lidarrMetadataProfiles(req('/api/lidarr/metadataprofiles', i)) },
  { name: 'Sonarr tags', anyOf: ['series.view', 'series.add'], service: 'sonarr',
    invoke: (i) => sonarrTags(req('/api/sonarr/tags', i)) },
  { name: 'Radarr tags', anyOf: ['movies.view', 'movies.add'], service: 'radarr',
    invoke: (i) => radarrTags(req('/api/radarr/tags', i)) },
  { name: 'Sonarr episodes', anyOf: ['series.view', 'activity.manage'], service: 'sonarr',
    invoke: (i) => sonarrEpisodes(req('/api/sonarr/7/episodes', i), withId('7')) },
  { name: 'dashboard layout list', anyOf: ['dashboard.view', 'settings.dashboardRefresh'], service: null,
    invoke: () => layoutsList() },
  { name: 'active dashboard layout', anyOf: ['dashboard.view'], service: null,
    invoke: (i) => layoutsActive(req('/api/dashboard-layouts/active?device=mobile', i)) },
];

const clientFor = { sonarr: mocks.getSonarrClient, radarr: mocks.getRadarrClient, lidarr: mocks.getLidarrClient };

// A stand-in client whose every method resolves to an empty list.
function emptyClient() {
  return new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : vi.fn(async () => [])) });
}

function member(permissions: Record<string, boolean>) {
  return { id: 'member-1', role: 'member', template: 'member', permissions };
}

/** A member holding exactly `granted` among the capabilities a case cares about. */
function memberWith(c: Case, granted: Capability[]) {
  const permissions: Record<string, boolean> = {};
  for (const cap of c.anyOf) permissions[cap] = granted.includes(cap);
  return member(permissions);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = null;
  for (const get of Object.values(clientFor)) get.mockImplementation(async () => emptyClient());
  mocks.listLayouts.mockResolvedValue({ layouts: [] });
  mocks.getActiveLayoutForUser.mockResolvedValue({ id: 'layout-1' });
});

function upstreamTouched(c: Case) {
  return c.service ? clientFor[c.service].mock.calls.length > 0 : mocks.listLayouts.mock.calls.length
    + mocks.getActiveLayoutForUser.mock.calls.length > 0;
}

describe('ARR and dashboard read routes', () => {
  it.each(cases)('$name: unauthenticated is 401 before any upstream work', async (c) => {
    const res = await c.invoke('sonarr-hd');
    expect(res.status).toBe(401);
    expect(upstreamTouched(c)).toBe(false);
  });

  it.each(cases)('$name: a member without the capability gets 403 and no upstream client', async (c) => {
    mocks.user = memberWith(c, []);
    const res = await c.invoke('sonarr-hd');
    expect(res.status).toBe(403);
    expect(upstreamTouched(c)).toBe(false);
  });

  it.each(cases.flatMap((c) => c.anyOf.map((cap) => ({ ...c, cap }))))(
    '$name: $cap alone is enough',
    async (c) => {
      mocks.user = memberWith(c, [c.cap]);
      const res = await c.invoke('instance-2');
      expect(res.status).toBe(200);
      expect(upstreamTouched(c)).toBe(true);
    },
  );

  it.each(cases)('$name: admin is allowed', async (c) => {
    mocks.user = { id: 'admin-1', role: 'admin', template: 'admin', permissions: {} };
    expect((await c.invoke('sonarr-hd')).status).toBe(200);
  });

  it.each(cases.filter((c) => c.service))('$name: reaches exactly the selected instance', async (c) => {
    mocks.user = memberWith(c, [c.anyOf[0]]);
    await c.invoke('instance-2');
    const get = clientFor[c.service!];
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('instance-2');
  });

  it.each(cases.filter((c) => c.service))('$name: a stale instance keeps the generic error', async (c) => {
    mocks.user = memberWith(c, [c.anyOf[0]]);
    clientFor[c.service!].mockRejectedValueOnce(new Error('No SONARR instance found for id "stale".'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await c.invoke('stale');
    error.mockRestore();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('stale');
  });

  it('asks each route for exactly its declared policy', async () => {
    mocks.user = { id: 'admin-1', role: 'admin', template: 'admin', permissions: {} };
    for (const c of cases) {
      vi.mocked(requireUserCapability).mockClear();
      vi.mocked(requireUserAnyCapability).mockClear();
      await c.invoke('sonarr-hd');
      if (c.anyOf.length === 1) {
        expect(requireUserCapability, c.name).toHaveBeenCalledWith(c.anyOf[0]);
      } else {
        expect(requireUserAnyCapability, c.name).toHaveBeenCalledWith(c.anyOf);
      }
    }
  });
});

