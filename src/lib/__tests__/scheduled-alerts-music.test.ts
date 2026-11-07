import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AxiosError, AxiosHeaders } from 'axios';
import type { ScheduledAlert } from '@prisma/client';

/**
 * Lidarr music alerts: one album's release, or an artist's next album (every
 * album Lidarr knows of with a release date ahead, picked up as Lidarr learns
 * of it). They read the music library, so they need music.view too.
 */

const mocks = vi.hoisted(() => ({
  getLidarrClients: vi.fn(),
  user: { id: 'u1', role: 'admin' } as Record<string, unknown>,
  create: vi.fn(),
}));

vi.mock('@/lib/service-helpers', () => ({
  getSonarrClients: async () => [],
  getRadarrClients: async () => [],
  getLidarrClients: mocks.getLidarrClients,
}));
vi.mock('@/lib/anilist-client', () => ({ getAnimeNextAiringEpisode: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUserCapability: vi.fn(async () => ({ ok: true, user: mocks.user })) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/app-settings', async (importOriginal) => ({ ...(await importOriginal<object>()), getOrCreateAppSettings: async () => ({ timeZone: 'UTC' }) }));
vi.mock('@/lib/db', () => ({
  prisma: {
    userSettings: { findUnique: async () => null },
    $transaction: async () => { mocks.create(); throw new Error('stop after the checks'); },
  },
}));

import { parseCreateInput } from '@/lib/scheduled-alerts/helpers';
import { createResolverContext, resolveAlertOccurrencesResult } from '@/lib/scheduled-alerts/resolver';
import { prepareScheduledAlerts } from '@/lib/settings-import/alerts';
import { POST as createAlert } from '@/app/api/scheduled-alerts/route';
import { POST as previewAlert } from '@/app/api/scheduled-alerts/preview/route';

const DAY = 24 * 60 * 60 * 1000;
const lidarrDate = (offsetDays: number) => `${new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10)}T00:00:00Z`;
const artist = { artistName: 'Massive Attack' };
const album = (id: number, releaseDate: string | undefined) => ({ id, artistId: 9, title: `Album ${id}`, releaseDate, artist });

const albumDraft = {
  source: 'LIDARR', externalId: '7', mediaType: 'music', albumId: 7, title: 'Album 7', subtitle: 'Massive Attack',
  instanceId: 'lid-1', href: '/music/album/7?instance=lid-1',
};
const artistDraft = {
  source: 'LIDARR', externalId: '9', mediaType: 'music', title: 'Massive Attack', subtitle: 'Next album',
  instanceId: 'lid-1', href: '/music/9?instance=lid-1',
};

const alertRow = (scope: 'album' | 'artist', externalId: string) => ({
  scheduleMode: 'release_relative', source: 'LIDARR', mediaType: 'music', externalId, title: scope === 'album' ? 'Album 7' : 'Massive Attack',
  subtitle: scope === 'album' ? 'Massive Attack' : 'Next album', posterUrl: null, href: null, instanceId: 'lid-1', metadata: {}, scope,
  releaseTypes: ['album'], offsetMinutes: 0, timeZone: 'UTC',
}) as unknown as ScheduledAlert;

const client = { getAlbumById: vi.fn(), getAlbums: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 'u1', role: 'admin' };
  mocks.getLidarrClients.mockResolvedValue([
    { connection: { id: 'lid-1', label: 'Lidarr' }, client },
    { connection: { id: 'lid-2', label: 'Other' }, client: { getAlbumById: vi.fn(), getAlbums: vi.fn() } },
  ]);
});

describe('music alert drafts', () => {
  it('takes a Lidarr album as an album alert and an artist as a next-album alert, both release reminders', () => {
    expect(parseCreateInput({ draft: albumDraft }, 'UTC')).toMatchObject({ scope: 'album', scheduleMode: 'release_relative', releaseTypes: ['album'] });
    // No release date yet, still a release reminder.
    expect(parseCreateInput({ draft: artistDraft }, 'UTC')).toMatchObject({ scope: 'artist', scheduleMode: 'release_relative', releaseTypes: ['album'] });
  });

  it('keeps music and Lidarr together and music scopes on music', () => {
    expect(parseCreateInput({ draft: { ...albumDraft, mediaType: 'movie' } }, 'UTC')).toEqual({ error: 'Invalid media draft' });
    expect(parseCreateInput({ draft: { ...albumDraft, source: 'RADARR' } }, 'UTC')).toEqual({ error: 'Invalid media draft' });
    expect(parseCreateInput({ draft: albumDraft, scope: 'episode' }, 'UTC')).toMatchObject({ scope: 'album' });
    expect(parseCreateInput({ draft: { source: 'RADARR', externalId: '5', mediaType: 'movie', title: 'Film' }, scheduleMode: 'release_relative', scope: 'artist' }, 'UTC'))
      .toMatchObject({ scope: 'movie' });
  });
});

describe('resolving music alerts', () => {
  it('reminds about one album on its release day, on its own instance', async () => {
    client.getAlbumById.mockResolvedValue(album(7, lidarrDate(10)));

    const { candidates, resolved } = await resolveAlertOccurrencesResult(alertRow('album', '7'), createResolverContext());

    expect(resolved).toBe(true);
    expect(client.getAlbumById).toHaveBeenCalledWith(7);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      targetKey: 'lidarr:lid-1:7', releaseKind: 'album', title: 'Massive Attack', body: 'Album 7',
      metadata: { albumId: 7, artistId: 9, instanceId: 'lid-1' },
    });
    expect(candidates[0].releaseAt?.toISOString().slice(0, 10)).toBe(lidarrDate(10).slice(0, 10));
  });

  it('reminds about every album ahead for an artist, so a newly announced one is picked up', async () => {
    client.getAlbums.mockResolvedValue([
      album(1, lidarrDate(-30)),
      album(2, lidarrDate(5)),
      album(3, undefined),
      album(4, lidarrDate(40)),
      album(5, lidarrDate(400)),
    ]);

    const { candidates } = await resolveAlertOccurrencesResult(alertRow('artist', '9'), createResolverContext());

    expect(client.getAlbums).toHaveBeenCalledWith(9);
    expect(candidates.map((c) => c.targetKey)).toEqual(['lidarr:lid-1:2', 'lidarr:lid-1:4']);
  });

  it('gives no reminder for an album Lidarr no longer has, and stays unresolved when Lidarr fails', async () => {
    const status = (code: number) => new AxiosError('Request failed', undefined, undefined, undefined, {
      status: code, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: null,
    });
    client.getAlbumById.mockRejectedValueOnce(status(404));
    expect(await resolveAlertOccurrencesResult(alertRow('album', '7'), createResolverContext())).toEqual({ candidates: [], resolved: true });

    client.getAlbumById.mockRejectedValueOnce(status(500));
    expect(await resolveAlertOccurrencesResult(alertRow('album', '7'), createResolverContext())).toEqual({ candidates: [], resolved: false });
  });
});

describe('music alert access', () => {
  const post = (handler: (r: NextRequest) => Promise<Response>, path: string, body: unknown) =>
    handler(new NextRequest(`http://helprr.test${path}`, { method: 'POST', body: JSON.stringify(body) }));
  const member = (music: boolean) => ({ id: 'm1', role: 'member', template: 'member', permissions: { 'scheduledAlerts.edit': true, 'scheduledAlerts.view': true, 'music.view': music } });

  it('refuses a member without music.view before reaching Lidarr or the database', async () => {
    mocks.user = member(false);
    expect((await post(createAlert, '/api/scheduled-alerts', { draft: artistDraft })).status).toBe(403);
    expect((await post(previewAlert, '/api/scheduled-alerts/preview', { draft: artistDraft })).status).toBe(403);
    expect(mocks.getLidarrClients).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('lets a member with music.view preview an artist alert', async () => {
    mocks.user = member(true);
    client.getAlbums.mockResolvedValue([album(2, lidarrDate(5))]);
    const res = await post(previewAlert, '/api/scheduled-alerts/preview', { draft: artistDraft });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ defaults: { scope: 'artist', scheduleMode: 'release_relative' }, candidates: [{ targetKey: 'lidarr:lid-1:2' }] });
  });
});

describe('importing music alerts', () => {
  it('keeps Lidarr album and artist alerts apart and skips a Lidarr alert that is not music', () => {
    const skipped: string[] = [];
    const base = { source: 'LIDARR', mediaType: 'music', title: 'x', scheduleMode: 'release_relative', releaseTypes: ['album'] };
    const prepared = prepareScheduledAlerts([
      { ...base, externalId: '7', scope: 'album' },
      { ...base, externalId: '7', scope: 'artist' },
      { ...base, externalId: '9' },
      { ...base, externalId: '8', mediaType: 'movie' },
    ], skipped, 'admin');

    expect(prepared.map((a) => [a.externalId, a.scope])).toEqual([['7', 'album'], ['7', 'artist'], ['9', 'artist']]);
    expect(skipped).toHaveLength(1);
  });
});
