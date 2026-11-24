import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { can } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';

// GET /api/{sonarr,radarr,lidarr}/health: who may read an instance's health,
// which instance it reaches, and what of Sonarr's answer is passed on. Real
// permission resolution.

const mocks = vi.hoisted(() => ({
  user: {} as Record<string, unknown>,
  connections: {} as Record<string, Array<{ id: string }>>,
  getHealth: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('@/lib/auth', () => {
  const gate = (caps: readonly Capability[]) => (caps.every((cap) => can(mocks.user as never, cap))
    ? { ok: true, user: mocks.user, session: {} }
    : { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
  return {
    requireUserCapability: async (cap: Capability) => gate([cap]),
    requireUserAllCapabilities: async (caps: readonly Capability[]) => gate(caps),
  };
});
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/arr-instances', () => ({
  listConnections: async (type: string) => mocks.connections[type] ?? [],
}));
vi.mock('@/lib/service-helpers', () => {
  const client = (type: string) => async (instanceId: string) => {
    mocks.getClient(type, instanceId);
    return { getHealth: mocks.getHealth };
  };
  return { getSonarrClient: client('SONARR'), getRadarrClient: client('RADARR'), getLidarrClient: client('LIDARR') };
});

import { GET as sonarrHealth } from '@/app/api/sonarr/health/route';
import { GET as radarrHealth } from '@/app/api/radarr/health/route';
import { GET as lidarrHealth } from '@/app/api/lidarr/health/route';

const ADMIN = { id: 'admin', role: 'admin', template: 'admin', permissions: {} };
const HEALTH_MEMBER = { id: 'h', role: 'member', template: 'member', permissions: { 'notify.health': true } };
// The member template has the library views but not notify.health.
const MEMBER = { id: 'm', role: 'member', template: 'member', permissions: {} };
const HEALTH_NO_MUSIC = { id: 'hn', role: 'member', template: 'member', permissions: { 'notify.health': true, 'music.view': false } };

const get = (route: typeof sonarrHealth, service: string, query: string) =>
  route(new NextRequest(`http://localhost/api/${service}/health${query}`));

const routes = [
  ['sonarr', sonarrHealth, 'SONARR', 'son-1'],
  ['radarr', radarrHealth, 'RADARR', 'rad-1'],
  ['lidarr', lidarrHealth, 'LIDARR', 'lid-1'],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = ADMIN;
  mocks.connections = { SONARR: [{ id: 'son-1' }], RADARR: [{ id: 'rad-1' }], LIDARR: [{ id: 'lid-1' }] };
  mocks.getHealth.mockResolvedValue([]);
});

describe.each(routes)('GET /api/%s/health', (service, route, type, instanceId) => {
  it.each([['an admin', ADMIN], ['a member with notify.health', HEALTH_MEMBER]])('is allowed for %s', async (_label, user) => {
    mocks.user = user;
    const res = await get(route, service, `?instanceId=${instanceId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.getClient).toHaveBeenCalledWith(type, instanceId);
  });

  it('is refused to a member without notify.health, asking the app nothing', async () => {
    mocks.user = MEMBER;
    expect((await get(route, service, `?instanceId=${instanceId}`)).status).toBe(403);
    expect(mocks.getHealth).not.toHaveBeenCalled();
  });

  it.each([
    ['no instance', ''],
    ['an empty instance', '?instanceId=%20'],
    ['an over-long instance', `?instanceId=${'x'.repeat(129)}`],
  ])('rejects %s with 400', async (_label, query) => {
    expect((await get(route, service, query)).status).toBe(400);
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown instance or one of another type, reaching nothing', async () => {
    const otherType = routes.find((r) => r[0] !== service)![3];
    for (const id of ['nope', otherType]) {
      expect((await get(route, service, `?instanceId=${id}`)).status).toBe(404);
    }
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it('passes on only source, type, message and an https help link, with credentials removed', async () => {
    mocks.getHealth.mockResolvedValue([
      {
        source: 'IndexerStatusCheck',
        type: 'warning',
        message: 'Indexer failed at https://tracker.example/api?apikey=secret-value&t=search',
        wikiUrl: 'https://wiki.servarr.com/sonarr/system#indexers',
        // Fields the view never shows are dropped.
        id: 7,
        fields: [{ name: 'apiKey', value: 'leak' }],
      },
      { source: 'ProxyCheck', type: 'error', message: 'Proxy down', wikiUrl: 'javascript:alert(1)' },
      null,
    ]);
    const res = await get(route, service, `?instanceId=${instanceId}`);
    const body = await res.json();
    expect(body).toEqual([
      {
        source: 'IndexerStatusCheck',
        type: 'warning',
        message: 'Indexer failed at https://tracker.example',
        wikiUrl: 'https://wiki.servarr.com/sonarr/system#indexers',
      },
      { source: 'ProxyCheck', type: 'error', message: 'Proxy down', wikiUrl: '' },
      { source: '', type: '', message: '', wikiUrl: '' },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/secret-value|leak/);
  });

  it('answers a failed read without upstream detail', async () => {
    mocks.getHealth.mockRejectedValue(new Error('connect ECONNREFUSED 192.168.1.10:8989'));
    const res = await get(route, service, `?instanceId=${instanceId}`);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('192.168');
  });
});

it('Lidarr health also needs music.view, like its push', async () => {
  mocks.user = HEALTH_NO_MUSIC;
  expect((await get(lidarrHealth, 'lidarr', '?instanceId=lid-1')).status).toBe(403);
  expect((await get(sonarrHealth, 'sonarr', '?instanceId=son-1')).status).toBe(200);
  expect(mocks.getClient).toHaveBeenCalledTimes(1);
});
