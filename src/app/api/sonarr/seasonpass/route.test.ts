import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { can } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';

// POST /api/sonarr/seasonpass: who may apply a Monitoring choice, to which
// instance, and which choices reach Sonarr. Real permission resolution.

const mocks = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  setSeriesMonitoring: vi.fn(),
  getSonarrClient: vi.fn(),
  invalidateTaggedLibrary: vi.fn(),
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
vi.mock('@/lib/service-helpers', () => ({ getSonarrClient: mocks.getSonarrClient }));
vi.mock('@/lib/cache/tagged-library', () => ({ invalidateTaggedLibrary: mocks.invalidateTaggedLibrary }));

import { POST } from './route';
import { SERIES_MONITOR_OPTIONS } from '@/lib/series-monitor';

const ADMIN = { id: 'admin', role: 'admin', template: 'admin', permissions: {} };
const MONITOR_EDITOR = { id: 'm', role: 'member', template: 'member', permissions: { 'series.editMonitoring': true } };
const VIEWER = { id: 'v', role: 'member', template: 'member', permissions: { 'series.editMonitoring': false } };

function post(body: unknown, query = '?instanceId=sonarr-anime') {
  return POST(new NextRequest(`http://localhost/api/sonarr/seasonpass${query}`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = ADMIN;
  mocks.setSeriesMonitoring.mockResolvedValue(undefined);
  mocks.getSonarrClient.mockImplementation(async (instanceId?: string) => {
    // resolveConnection's refusal of an id that is not a Sonarr instance.
    if (instanceId === 'radarr-1') throw new Error('No SONARR instance found for id "radarr-1".');
    return { setSeriesMonitoring: mocks.setSeriesMonitoring };
  });
});

describe('POST /api/sonarr/seasonpass', () => {
  it('applies the choice on the instance in the query for a member with series.editMonitoring', async () => {
    mocks.user = MONITOR_EDITOR;
    const res = await post({ ids: [4, 4, 9], monitor: 'future' });
    expect(res.status).toBe(200);
    expect(mocks.getSonarrClient).toHaveBeenCalledWith('sonarr-anime');
    expect(mocks.setSeriesMonitoring).toHaveBeenCalledWith([4, 9], 'future');
    expect(mocks.invalidateTaggedLibrary).toHaveBeenCalledWith('sonarr', 'sonarr-anime');
  });

  it('refuses a signed-out user and a member without series.editMonitoring', async () => {
    mocks.user = null;
    expect((await post({ ids: [4], monitor: 'all' })).status).toBe(401);
    mocks.user = VIEWER;
    expect((await post({ ids: [4], monitor: 'all' })).status).toBe(403);
    expect(mocks.getSonarrClient).not.toHaveBeenCalled();
    expect(mocks.setSeriesMonitoring).not.toHaveBeenCalled();
  });

  it('sends nothing to an instance that is not a Sonarr one', async () => {
    const res = await post({ ids: [4], monitor: 'all' }, '?instanceId=radarr-1');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to update monitoring' });
    expect(mocks.setSeriesMonitoring).not.toHaveBeenCalled();
  });

  it('uses the default instance when none is named', async () => {
    await post({ ids: [4], monitor: 'none' }, '');
    expect(mocks.getSonarrClient).toHaveBeenCalledWith(undefined);
  });

  it.each(SERIES_MONITOR_OPTIONS.map((o) => o.value))('accepts Sonarr’s %s choice', async (monitor) => {
    expect((await post({ ids: [1], monitor })).status).toBe(200);
    expect(mocks.setSeriesMonitoring).toHaveBeenCalledWith([1], monitor);
  });

  it.each([
    ['an internal Sonarr type', { ids: [1], monitor: 'skip' }],
    ['an unknown choice', { ids: [1], monitor: 'everything' }],
    ['a missing choice', { ids: [1] }],
    ['a non-string choice', { ids: [1], monitor: 1 }],
    ['no ids', { ids: [], monitor: 'all' }],
    ['a bad id', { ids: [1, -2], monitor: 'all' }],
    ['an array body', [{ ids: [1], monitor: 'all' }]],
  ])('rejects %s', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(mocks.setSeriesMonitoring).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    expect((await post('{nope')).status).toBe(400);
  });
});
