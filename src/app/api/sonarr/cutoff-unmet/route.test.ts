import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { can } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';

// GET /api/sonarr/cutoff-unmet: who may read it, and how each instance's
// Wanted → Cutoff Unmet list becomes the Series page's row keys.

const mocks = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  getSonarrClients: vi.fn(),
  cache: new Map<string, unknown>(),
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
vi.mock('@/lib/service-helpers', () => ({ getSonarrClients: mocks.getSonarrClients }));
vi.mock('@/lib/cache/json-cache', () => ({
  getCachedJson: async (scope: string, key: string) => mocks.cache.get(`${scope}:${key}`) ?? null,
  setCachedJson: async (scope: string, key: string, value: unknown) => { mocks.cache.set(`${scope}:${key}`, value); },
}));

import { GET } from './route';

const VIEWER = { id: 'v', role: 'member', template: 'member', permissions: { 'series.view': true } };
const NO_SERIES = { id: 'n', role: 'member', template: 'member', permissions: { 'series.view': false } };

function instance(id: string, label: string, read: () => Promise<{ seriesIds: number[]; complete: boolean }>) {
  return { connection: { id, label }, client: { getCutoffUnmetSeriesIds: vi.fn(read) } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cache.clear();
  mocks.user = VIEWER;
});

describe('GET /api/sonarr/cutoff-unmet', () => {
  it('needs series.view and reads nothing without it', async () => {
    mocks.user = NO_SERIES;
    expect((await GET()).status).toBe(403);
    mocks.user = null;
    expect((await GET()).status).toBe(401);
    expect(mocks.getSonarrClients).not.toHaveBeenCalled();
  });

  it('keys each series by its own instance, so the same id on two instances stays apart', async () => {
    mocks.getSonarrClients.mockResolvedValue([
      instance('a', 'Sonarr', async () => ({ seriesIds: [5, 7], complete: true })),
      instance('b', 'Anime', async () => ({ seriesIds: [5], complete: true })),
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(await res.json()).toEqual({ series: ['a:5', 'a:7', 'b:5'], incomplete: [] });
  });

  it('names an instance that failed or was cut short, and serves a cached list without asking Sonarr', async () => {
    const cut = instance('b', 'Anime', async () => ({ seriesIds: [1], complete: false }));
    mocks.getSonarrClients.mockResolvedValue([
      instance('a', 'Sonarr', async () => { throw new Error('connect ECONNREFUSED 10.0.0.2:8989'); }),
      cut,
    ]);
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ series: ['b:1'], incomplete: ['Sonarr', 'Anime'] });
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');

    await GET();
    expect(cut.client.getCutoffUnmetSeriesIds).toHaveBeenCalledTimes(1);
  });

  it('is an error when every instance failed', async () => {
    mocks.getSonarrClients.mockResolvedValue([
      instance('a', 'Sonarr', async () => { throw new Error('down'); }),
    ]);
    const res = await GET();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'No Sonarr instance answered' });
  });
});
