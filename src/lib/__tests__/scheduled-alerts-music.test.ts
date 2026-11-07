import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AxiosError, AxiosHeaders } from 'axios';
import type { ScheduledAlert } from '@prisma/client';

/**
 * Lidarr music alerts: one album's release, or an artist's next album (a push
 * as soon as Lidarr learns of an album ahead, and a reminder before each
 * album's release). They read the music library, so they need music.view too.
 */

const mocks = vi.hoisted(() => ({
  getLidarrClients: vi.fn(),
  user: { id: 'u1', role: 'admin' } as Record<string, unknown>,
  create: vi.fn(),
  inPost: false,
  alertFindMany: vi.fn(),
  alertUpdate: vi.fn(),
  alertUpdateMany: vi.fn(),
  alertFindFirst: vi.fn(),
  occFindMany: vi.fn(),
  occCreate: vi.fn(),
  occUpdate: vi.fn(),
  occUpdateMany: vi.fn(),
  occUpsert: vi.fn(),
  notifyEvent: vi.fn(),
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
    // POST stops here; announcements run their writes against the same mocks.
    $transaction: async (fn: unknown) => {
      if (typeof fn !== 'function') throw new Error('unexpected batch');
      if (fn.length === 1 && mocks.inPost) { mocks.create(); throw new Error('stop after the checks'); }
      const { prisma } = await import('@/lib/db');
      return fn(prisma);
    },
    serviceConnection: { findFirst: async () => null, findMany: async () => [] },
    scheduledAlert: { findMany: mocks.alertFindMany, update: mocks.alertUpdate, updateMany: mocks.alertUpdateMany,
      findFirst: mocks.alertFindFirst, findUnique: async () => null },
    scheduledAlertOccurrence: {
      findMany: mocks.occFindMany, create: mocks.occCreate, update: mocks.occUpdate,
      updateMany: mocks.occUpdateMany, upsert: mocks.occUpsert,
    },
  },
}));
vi.mock('@/lib/notification-service', () => ({ notifyEvent: mocks.notifyEvent }));

import { parseCreateInput } from '@/lib/scheduled-alerts/helpers';
import { createResolverContext, resolveAlertOccurrencesResult } from '@/lib/scheduled-alerts/resolver';
import { prepareScheduledAlerts } from '@/lib/settings-import/alerts';
import { announceNewAlbums, checkScheduledAlerts, refreshScheduledAlertOccurrences } from '@/lib/scheduled-alerts/delivery';
import { POST as createAlert } from '@/app/api/scheduled-alerts/route';
import { POST as previewAlert } from '@/app/api/scheduled-alerts/preview/route';
import { PATCH as editAlert } from '@/app/api/scheduled-alerts/[id]/route';

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
  mocks.inPost = false;
  mocks.alertUpdateMany.mockResolvedValue({ count: 1 });
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

  it('keeps music and Lidarr together, takes a music scope only from the draft, and wants numeric ids', () => {
    expect(parseCreateInput({ draft: { ...albumDraft, mediaType: 'movie' } }, 'UTC')).toEqual({ error: 'Invalid media draft' });
    expect(parseCreateInput({ draft: { ...albumDraft, source: 'RADARR' } }, 'UTC')).toEqual({ error: 'Invalid media draft' });
    expect(parseCreateInput({ draft: { ...artistDraft, externalId: 'abc' } }, 'UTC')).toEqual({ error: 'Invalid media draft' });
    expect(parseCreateInput({ draft: { ...albumDraft, albumId: 8 } }, 'UTC')).toEqual({ error: 'Invalid media draft' });
    expect(parseCreateInput({ draft: albumDraft, scope: 'episode' }, 'UTC')).toMatchObject({ scope: 'album' });
    // An album id must not be read as an artist id.
    expect(parseCreateInput({ draft: albumDraft, scope: 'artist' }, 'UTC')).toMatchObject({ scope: 'album' });
    expect(parseCreateInput({ draft: artistDraft, scope: 'album' }, 'UTC')).toMatchObject({ scope: 'artist' });
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

    const { candidates, upcomingAlbums } = await resolveAlertOccurrencesResult(alertRow('artist', '9'), createResolverContext());

    expect(client.getAlbums).toHaveBeenCalledWith(9);
    expect(candidates.map((c) => c.targetKey)).toEqual(['lidarr:lid-1:2', 'lidarr:lid-1:4']);
    // Every album ahead counts for the announcement, however far off.
    expect(upcomingAlbums?.map((a) => a.key)).toEqual(['lid-1:2', 'lid-1:4', 'lid-1:5']);
    expect(upcomingAlbums?.[0]).toMatchObject({ title: 'Album 2', artistName: 'Massive Attack' });
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
    mocks.inPost = true;
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

describe('announcing an artist\'s new album', () => {
  const upcoming = (...ids: number[]) => ids.map((id) => ({ key: `lid-1:${id}`, title: `Album ${id}`, artistName: 'Massive Attack', releaseAt: new Date(Date.now() + 40 * DAY) }));
  const readAt = new Date('2026-11-07T08:00:00Z');
  const alert = (knownAlbumKeys?: string[]) =>
    ({ ...alertRow('artist', '9'), id: 'a1', updatedAt: readAt, metadata: knownAlbumKeys ? { knownAlbumKeys } : {} }) as unknown as ScheduledAlert;

  it('only records what Lidarr already knows the first time', async () => {
    await announceNewAlbums(alert(), upcoming(2, 4));
    expect(mocks.occCreate).not.toHaveBeenCalled();
    expect(mocks.alertUpdateMany).toHaveBeenCalledWith({ where: { id: 'a1', updatedAt: readAt }, data: { metadata: { knownAlbumKeys: ['lid-1:2', 'lid-1:4'] } } });
  });

  it('pushes now for an album Lidarr learned of since, once', async () => {
    await announceNewAlbums(alert(['lid-1:2']), upcoming(2, 6));
    expect(mocks.occCreate).toHaveBeenCalledTimes(1);
    const { data } = mocks.occCreate.mock.calls[0][0];
    expect(data).toMatchObject({ alertId: 'a1', targetKey: 'lidarr:lid-1:6:announced', releaseKind: 'album', title: 'Massive Attack' });
    expect(data.body).toMatch(/^New album: Album 6, out /);
    expect(Math.abs(data.notifyAt.getTime() - Date.now())).toBeLessThan(5_000);
    expect(mocks.alertUpdateMany.mock.calls[0][0].data.metadata.knownAlbumKeys).toEqual(['lid-1:2', 'lid-1:6']);

    vi.clearAllMocks();
    await announceNewAlbums(alert(['lid-1:2', 'lid-1:6']), upcoming(6));
    expect(mocks.occCreate).not.toHaveBeenCalled();
    expect(mocks.alertUpdateMany).not.toHaveBeenCalled();
  });

  it('leaves the push to the other resolve when the alert changed since it was read', async () => {
    // An edit and the background refresh resolved together: only the first write announces.
    mocks.alertUpdateMany.mockResolvedValue({ count: 0 });
    await announceNewAlbums(alert(['lid-1:2']), upcoming(2, 6));
    expect(mocks.occCreate).not.toHaveBeenCalled();
  });

  it('is part of the background refresh', async () => {
    client.getAlbums.mockResolvedValue([album(2, lidarrDate(5)), album(6, lidarrDate(200))]);
    mocks.alertFindMany.mockResolvedValue([{ ...alert(['lid-1:2']), user: { role: 'admin' } }]);
    mocks.occFindMany.mockResolvedValue([]);

    await refreshScheduledAlertOccurrences();

    expect(mocks.occUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.occCreate).toHaveBeenCalledTimes(1);
    expect(mocks.occCreate.mock.calls[0][0].data.targetKey).toBe('lidarr:lid-1:6:announced');
  });
});

describe('an owner who lost music.view', () => {
  const noMusic = { role: 'member', template: 'member', permissions: { 'music.view': false } };

  it('gets no more music reminders, and Lidarr is not asked', async () => {
    const readAt = new Date('2026-11-07T08:00:00Z');
    mocks.alertFindMany.mockResolvedValue([{ ...alertRow('artist', '9'), id: 'a1', updatedAt: readAt, metadata: { knownAlbumKeys: ['lid-1:2'] }, user: noMusic }]);
    mocks.occFindMany.mockResolvedValue([{ id: 'o1', targetKey: 'lidarr:lid-1:2', notifyAt: new Date(Date.now() + DAY), status: 'pending' }]);

    await refreshScheduledAlertOccurrences();

    expect(client.getAlbums).not.toHaveBeenCalled();
    // Its seen albums start afresh, so regaining music.view does not announce a backlog.
    expect(mocks.alertUpdateMany).toHaveBeenCalledWith({ where: { id: 'a1', updatedAt: readAt }, data: { updatedAt: expect.any(Date), metadata: {} } });
    expect(mocks.occUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['o1'] } }, data: expect.objectContaining({ status: 'cancelled' }) }));
  });

  it('is not sent a due music push', async () => {
    mocks.occFindMany.mockResolvedValue([{
      id: 'o2', alertId: 'a1', attempts: 0, metadata: null, title: 'Massive Attack', body: 'Album 2', releaseKind: 'album',
      alert: { ...alertRow('album', '2'), id: 'a1', userId: 'm1', user: noMusic },
    }]);

    await checkScheduledAlerts();

    expect(mocks.notifyEvent).not.toHaveBeenCalled();
    expect(mocks.occUpdate).toHaveBeenCalledWith({ where: { id: 'o2' }, data: expect.objectContaining({ status: 'cancelled' }) });
  });
});

describe('reactivating a cancelled artist alert', () => {
  it('starts its seen albums afresh, so albums added meanwhile are not announced at once', async () => {
    const existing = { ...alertRow('artist', '9'), id: 'a1', userId: 'u1', status: 'cancelled', cancelledAt: null, createdAt: new Date(), updatedAt: new Date(), metadata: { knownAlbumKeys: ['lid-1:2'] } };
    mocks.alertFindFirst.mockResolvedValue(existing);
    mocks.alertUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...existing, ...data, updatedAt: new Date() }));
    mocks.occFindMany.mockResolvedValue([]);
    client.getAlbums.mockResolvedValue([album(2, lidarrDate(5)), album(6, lidarrDate(60))]);

    const res = await editAlert(
      new NextRequest('http://helprr.test/api/scheduled-alerts/a1', { method: 'PATCH', body: JSON.stringify({ status: 'active' }) }),
      { params: Promise.resolve({ id: 'a1' }) },
    );

    expect(res.status).toBe(200);
    expect(mocks.alertUpdate.mock.calls[0][0].data.metadata).toEqual({});
    // The resolve after it only records what Lidarr knows now.
    expect(mocks.occCreate).not.toHaveBeenCalled();
    expect(mocks.alertUpdateMany.mock.calls[0][0].data.metadata.knownAlbumKeys).toEqual(['lid-1:2', 'lid-1:6']);
  });
});
