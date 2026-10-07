import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(), getSonarrClient: vi.fn(), getRadarrClient: vi.fn(),
  sonarrReprocess: vi.fn(), radarrReprocess: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/service-helpers', () => ({ getSonarrClient: mocks.getSonarrClient, getRadarrClient: mocks.getRadarrClient }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { POST } from './route';

const post = (body: unknown, query = '') => POST(new NextRequest(`http://localhost/api/activity/manualimport/reprocess${query}`, {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
}));
const items = [{ id: 1, path: '/downloads/pack/a.mkv', seriesId: 47, episodeIds: [] }];

describe('POST /api/activity/manualimport/reprocess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserCapability.mockResolvedValue({ ok: true });
    mocks.getSonarrClient.mockResolvedValue({ reprocessManualImport: mocks.sonarrReprocess });
    mocks.getRadarrClient.mockResolvedValue({ reprocessManualImport: mocks.radarrReprocess });
    mocks.sonarrReprocess.mockResolvedValue([{ id: 1, seasonNumber: 1 }]);
    mocks.radarrReprocess.mockResolvedValue([{ id: 1 }]);
  });

  it('requires the activity.manage capability and does nothing without it', async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const res = await post({ source: 'sonarr', items });
    expect(res.status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('activity.manage');
    expect(mocks.getSonarrClient).not.toHaveBeenCalled();
    expect(mocks.getRadarrClient).not.toHaveBeenCalled();
  });

  it('asks the chosen arr instance to re-evaluate the files and returns its answer', async () => {
    const res = await post({ source: 'sonarr', instanceId: 'son-2', items });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 1, seasonNumber: 1 }]);
    expect(mocks.getSonarrClient).toHaveBeenCalledWith('son-2');
    expect(mocks.sonarrReprocess).toHaveBeenCalledWith(items);
    expect(mocks.getRadarrClient).not.toHaveBeenCalled();
  });

  it('routes Radarr files to Radarr, with the instance from the query taking precedence', async () => {
    const movieItems = [{ id: 1, path: '/downloads/m.mkv', movieId: 12 }];
    const res = await post({ source: 'radarr', instanceId: 'ignored', items: movieItems }, '?instanceId=rad-1');
    expect(res.status).toBe(200);
    expect(mocks.getRadarrClient).toHaveBeenCalledWith('rad-1');
    expect(mocks.radarrReprocess).toHaveBeenCalledWith(movieItems);
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['a body that is not an object', [items]],
    ['an unknown source', { source: 'lidarr', items }],
    ['no items', { source: 'sonarr', items: [] }],
    ['items that are not objects', { source: 'sonarr', items: ['/downloads/pack/a.mkv'] }],
    ['too many items', { source: 'sonarr', items: Array.from({ length: 1001 }, () => ({ id: 1 })) }],
  ])('rejects %s without calling the arr', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(mocks.getSonarrClient).not.toHaveBeenCalled();
    expect(mocks.getRadarrClient).not.toHaveBeenCalled();
  });
});
