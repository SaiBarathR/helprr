import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Activity → Missing / Cutoff Unmet "Search all" sends each app's own
 * whole-list search command through the existing command routes, to the
 * instance named in the query, behind activity.manage.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getClient: vi.fn(),
  client: { searchWanted: vi.fn() },
}));
vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.auth }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClient: (id?: string) => mocks.getClient('sonarr', id),
  getRadarrClient: (id?: string) => mocks.getClient('radarr', id),
  getLidarrClient: (id?: string) => mocks.getClient('lidarr', id),
}));

import { POST as sonarrCommand } from '@/app/api/sonarr/command/route';
import { POST as radarrCommand } from '@/app/api/radarr/command/route';
import { POST as lidarrCommand } from '@/app/api/lidarr/command/route';

type Handler = (request: NextRequest) => Promise<Response>;
const post = (handler: Handler, service: string, name: string) =>
  handler(new NextRequest(`http://helprr.test/api/${service}/command?instanceId=inst-2`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'admin', role: 'admin' } });
  mocks.getClient.mockResolvedValue(mocks.client);
  mocks.client.searchWanted.mockResolvedValue({ id: 1, status: 'queued' });
});

describe.each([
  { service: 'sonarr', handler: sonarrCommand as Handler, missing: 'MissingEpisodeSearch', cutoff: 'CutoffUnmetEpisodeSearch' },
  { service: 'radarr', handler: radarrCommand as Handler, missing: 'MissingMoviesSearch', cutoff: 'CutoffUnmetMoviesSearch' },
  { service: 'lidarr', handler: lidarrCommand as Handler, missing: 'MissingAlbumSearch', cutoff: 'CutoffUnmetAlbumSearch' },
])('/api/$service/command wanted searches', ({ service, handler, missing, cutoff }) => {
  it.each([[missing, 'missing'], [cutoff, 'cutoff']])('%s searches the %s list on the named instance', async (name, type) => {
    const res = await post(handler, service, name);
    expect(res.status).toBe(200);
    expect(mocks.auth).toHaveBeenCalledWith('activity.manage');
    expect(mocks.getClient).toHaveBeenCalledWith(service, 'inst-2');
    expect(mocks.client.searchWanted).toHaveBeenCalledWith(type);
  });

  it('refuses a member without activity.manage before reaching the app', async () => {
    mocks.auth.mockResolvedValue({ ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) });
    const res = await post(handler, service, missing);
    expect(res.status).toBe(403);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.client.searchWanted).not.toHaveBeenCalled();
  });
});
