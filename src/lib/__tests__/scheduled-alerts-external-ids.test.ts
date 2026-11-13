import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { ScheduledAlert } from '@prisma/client';

/**
 * Release reminders saved by a TMDB/TVDB id (Discover, the watchlist) keep no
 * date: each resolve finds the title in the library by that id kind (TMDB ↔
 * Radarr tmdbId, TVDB/TMDB ↔ Sonarr tvdbId/tmdbId, per instance), else reads
 * TMDB's own dates. A TMDB id is never read as a Sonarr id.
 */

const mocks = vi.hoisted(() => ({
  library: vi.fn(),
  getTMDBClient: vi.fn(),
  getRadarrClients: vi.fn(),
  getSonarrClients: vi.fn(),
  create: vi.fn(),
  inPost: false,
  occFindMany: vi.fn(),
  occUpdateMany: vi.fn(),
  occUpsert: vi.fn(),
  region: 'US',
}));

vi.mock('@/lib/cache/arr-library', () => ({ loadCachedArrLibrary: mocks.library }));
vi.mock('@/lib/service-helpers', () => ({
  getRadarrClients: mocks.getRadarrClients,
  getSonarrClients: mocks.getSonarrClients,
  getLidarrClients: async () => [],
  getTMDBClient: mocks.getTMDBClient,
}));
vi.mock('@/lib/anilist-client', () => ({ getAnimeNextAiringEpisode: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUserCapability: vi.fn(async () => ({ ok: true, user: { id: 'u1', role: 'admin' } })) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/app-settings', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getOrCreateAppSettings: async () => ({ timeZone: 'UTC', watchProviderRegion: mocks.region }),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    userSettings: { findUnique: async () => null },
    $transaction: async () => { mocks.create(); throw new Error('stop after the checks'); },
    scheduledAlertOccurrence: { findMany: mocks.occFindMany, updateMany: mocks.occUpdateMany, upsert: mocks.occUpsert },
  },
}));

import { ConfigurationError } from '@/lib/config-error';
import { createResolverContext, resolveAlertOccurrencesResult } from '@/lib/scheduled-alerts/resolver';
import { upsertOccurrencesForAlert } from '@/lib/scheduled-alerts/delivery';
import { POST as createAlert } from '@/app/api/scheduled-alerts/route';

const DAY = 24 * 60 * 60 * 1000;
const day = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const nineUtc = (offsetDays: number) => `${day(offsetDays)}T09:00:00.000Z`;
// The instant, whatever Date subclass holds it.
const iso = (d: Date | null | undefined) => (d ? new Date(d.getTime()).toISOString() : null);

const radarr = { getMovieById: vi.fn(), getCalendar: vi.fn(async () => []) };
const sonarr1 = { getEpisodeById: vi.fn(), getCalendar: vi.fn() };
const sonarr2 = { getEpisodeById: vi.fn(), getCalendar: vi.fn() };
const tmdb = { movieReleaseDates: vi.fn(), tvDetails: vi.fn(), tvExternalIds: vi.fn(), findByExternalId: vi.fn() };

const row = (source: 'TMDB' | 'TVDB', mediaType: 'movie' | 'series', externalId: string, releaseTypes: string[]) => ({
  id: 'a1', userId: 'u1', source, mediaType, externalId, title: 'Title', subtitle: null, posterUrl: null, href: null, instanceId: null,
  // As saved: no release date, and old rows carry only what they always did.
  scheduleMode: 'release_relative', scope: mediaType, releaseTypes, offsetMinutes: 0, timeZone: 'UTC', status: 'active',
  metadata: { migratedFromWatchlist: true }, cancelledAt: null, createdAt: new Date(), updatedAt: new Date(),
}) as unknown as ScheduledAlert;
// Every instance answered.
const lib = (movies: unknown[], series: unknown[]) => ({ movies, series, moviesComplete: true, seriesComplete: true });
const resolve = (alert: ScheduledAlert) => resolveAlertOccurrencesResult(alert, createResolverContext());
const calendarEp = (id: number, seriesId: number, offsetDays: number) => ({
  id, seriesId, seasonNumber: 2, episodeNumber: id, title: `Ep ${id}`, airDateUtc: new Date(Date.now() + offsetDays * DAY).toISOString(), series: { title: `Series ${seriesId}` },
});
const releaseDates = (country: string, entries: Array<[number, string]>) => ({ iso_3166_1: country, release_dates: entries.map(([type, date]) => ({ type, release_date: `${date}T00:00:00.000Z`, certification: '' })) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inPost = false;
  mocks.region = 'US';
  mocks.library.mockResolvedValue(lib([], []));
  mocks.getTMDBClient.mockResolvedValue(tmdb);
  mocks.getRadarrClients.mockResolvedValue([{ connection: { id: 'rad-1' }, client: radarr }]);
  mocks.getSonarrClients.mockResolvedValue([{ connection: { id: 'son-1' }, client: sonarr1 }, { connection: { id: 'son-2' }, client: sonarr2 }]);
  sonarr1.getCalendar.mockResolvedValue([]);
  sonarr2.getCalendar.mockResolvedValue([]);
  mocks.occFindMany.mockResolvedValue([]);
});

describe('a film saved by its TMDB id', () => {
  it('in the library: reminds from Radarr\'s film with that tmdbId, at 9:00', async () => {
    mocks.library.mockResolvedValue(lib([{ id: 5, tmdbId: 603, instanceId: 'rad-1' }, { id: 603, tmdbId: 1, instanceId: 'rad-1' }], []));
    radarr.getMovieById.mockResolvedValue({ id: 5, title: 'Film', year: 2026, digitalRelease: `${day(10)}T00:00:00Z` });

    const { candidates, resolved } = await resolve(row('TMDB', 'movie', '603', ['digital']));

    expect(resolved).toBe(true);
    expect(radarr.getMovieById).toHaveBeenCalledWith(5);
    expect(candidates).toMatchObject([{ targetKey: 'radarr:rad-1:5:digital', releaseKind: 'digital' }]);
    expect(iso(candidates[0].releaseAt)).toBe(nineUtc(10));
    expect(tmdb.movieReleaseDates).not.toHaveBeenCalled();
  });

  it('not in the library: reminds from TMDB\'s dates in Helprr\'s region, else the US, else the earliest', async () => {
    mocks.region = 'GB';
    tmdb.movieReleaseDates.mockResolvedValue({ id: 603, results: [
      releaseDates('US', [[3, day(5)], [4, day(30)], [5, day(60)]]),
      releaseDates('GB', [[4, day(20)]]),
      releaseDates('FR', [[3, day(2)]]),
    ] });

    const { candidates, resolved } = await resolve(row('TMDB', 'movie', '603', ['digital', 'cinema', 'physical']));

    expect(resolved).toBe(true);
    expect(radarr.getMovieById).not.toHaveBeenCalled();
    expect(candidates.map((c) => [c.targetKey, iso(c.releaseAt), c.body])).toEqual([
      ['tmdb:movie:603:cinema', nineUtc(5), 'Cinema release'],
      ['tmdb:movie:603:digital', nineUtc(20), 'Digital release'],
      ['tmdb:movie:603:physical', nineUtc(60), 'Physical release'],
    ]);
  });

  it('already out on TMDB: flagged, and the save refuses it', async () => {
    tmdb.movieReleaseDates.mockResolvedValue({ id: 603, results: [releaseDates('US', [[3, day(-90)], [4, day(-30)]])] });
    expect(await resolve(row('TMDB', 'movie', '603', ['digital']))).toEqual({ candidates: [], resolved: true, released: 'movie' });

    mocks.inPost = true;
    const res = await createAlert(new NextRequest('http://helprr.test/api/scheduled-alerts', { method: 'POST', body: JSON.stringify({
      draft: { source: 'TMDB', externalId: '603', mediaType: 'movie', title: 'Film', releaseDate: day(-90) },
      scheduleMode: 'release_relative', releaseTypes: ['digital'],
    }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^This movie is already out/);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('stays unresolved, keeping what it had, when the library or TMDB cannot be read', async () => {
    mocks.library.mockRejectedValueOnce(new Error('redis down'));
    expect(await resolve(row('TMDB', 'movie', '603', ['digital']))).toEqual({ candidates: [], resolved: false });
    expect(tmdb.movieReleaseDates).not.toHaveBeenCalled();

    tmdb.movieReleaseDates.mockRejectedValueOnce(new Error('TMDB 503'));
    expect(await resolve(row('TMDB', 'movie', '603', ['digital']))).toEqual({ candidates: [], resolved: false });

    mocks.getTMDBClient.mockRejectedValueOnce(new ConfigurationError('TMDB is not configured.'));
    expect(await resolve(row('TMDB', 'movie', '603', ['digital']))).toEqual({ candidates: [], resolved: false });
  });
});

describe('a series saved by its TMDB id', () => {
  it('in the library: only the instance whose series has that tmdbId, never Sonarr series 603', async () => {
    // son-1 has a different show whose Sonarr id is 603: the old resolver matched it.
    mocks.library.mockResolvedValue(lib([], [
      { id: 603, tvdbId: 1, tmdbId: 1, instanceId: 'son-1' },
      { id: 3, tvdbId: 81189, tmdbId: 603, instanceId: 'son-2' },
    ]));
    sonarr1.getCalendar.mockResolvedValue([calendarEp(90, 603, 2)]);
    sonarr2.getCalendar.mockResolvedValue([calendarEp(21, 3, 4)]);

    const { candidates } = await resolve(row('TMDB', 'series', '603', ['episode']));

    expect(sonarr1.getCalendar).not.toHaveBeenCalled();
    expect(candidates).toMatchObject([{ targetKey: 'sonarr:son-2:21', title: 'Series 3', body: 'S02E21 - Ep 21' }]);
  });

  it('in a Sonarr that keeps no TMDB id: matched by the TVDB id TMDB gives', async () => {
    mocks.library.mockResolvedValue(lib([], [{ id: 3, tvdbId: 81189, instanceId: 'son-2' }]));
    tmdb.tvExternalIds.mockResolvedValue({ tvdb_id: 81189 });
    sonarr2.getCalendar.mockResolvedValue([calendarEp(21, 3, 4)]);

    expect((await resolve(row('TMDB', 'series', '603', ['episode']))).candidates).toMatchObject([{ targetKey: 'sonarr:son-2:21' }]);
  });

  it('not in the library: reminds of TMDB\'s next episode at 9:00 on its air day', async () => {
    tmdb.tvExternalIds.mockResolvedValue({ tvdb_id: null });
    tmdb.tvDetails.mockResolvedValue({ next_episode_to_air: { air_date: day(6), season_number: 2, episode_number: 5, name: 'Five' } });

    const { candidates, resolved } = await resolve(row('TMDB', 'series', '603', ['episode']));

    expect(resolved).toBe(true);
    expect(tmdb.tvDetails).toHaveBeenCalledWith(603);
    expect(candidates.map((c) => [c.targetKey, iso(c.releaseAt), c.body])).toEqual([['tmdb:tv:603:S02E05', nineUtc(6), 'S02E05 - Five']]);
    expect(sonarr1.getCalendar).not.toHaveBeenCalled();
  });

  it('cancels the wrong series\' pending reminders an older resolve left', async () => {
    mocks.library.mockResolvedValue(lib([], [{ id: 3, tmdbId: 603, instanceId: 'son-2' }]));
    sonarr2.getCalendar.mockResolvedValue([calendarEp(21, 3, 4)]);
    const alert = row('TMDB', 'series', '603', ['episode']);
    const { candidates, resolved } = await resolve(alert);
    mocks.occFindMany.mockResolvedValue([{ id: 'old', targetKey: 'sonarr:son-1:90', notifyAt: new Date(Date.now() + 2 * DAY) }]);

    await upsertOccurrencesForAlert(alert, candidates, { resolved });

    expect(mocks.occUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['old'] } }, data: expect.objectContaining({ status: 'cancelled' }) }));
  });
});

describe('a series saved by its TVDB id', () => {
  it('in the library: the instance whose series has that tvdbId', async () => {
    mocks.library.mockResolvedValue(lib([], [{ id: 3, tvdbId: 81189, instanceId: 'son-1' }]));
    sonarr1.getCalendar.mockResolvedValue([calendarEp(21, 3, 4), calendarEp(22, 81189, 5)]);

    expect((await resolve(row('TVDB', 'series', '81189', ['episode']))).candidates.map((c) => c.targetKey)).toEqual(['sonarr:son-1:21']);
    expect(tmdb.findByExternalId).not.toHaveBeenCalled();
  });

  it('not in the library: TMDB\'s next episode, found through the TVDB id', async () => {
    tmdb.findByExternalId.mockResolvedValue({ tv_results: [{ id: 603 }], movie_results: [], person_results: [] });
    tmdb.tvDetails.mockResolvedValue({ next_episode_to_air: { air_date: day(6), season_number: 1, episode_number: 2, name: '' } });

    const { candidates } = await resolve(row('TVDB', 'series', '81189', ['episode']));

    expect(tmdb.findByExternalId).toHaveBeenCalledWith('81189', 'tvdb_id');
    expect(candidates).toMatchObject([{ targetKey: 'tmdb:tv:603:S01E02', body: 'S01E02' }]);
  });

  it('with no next episode on TMDB: resolved, nothing to remind of yet', async () => {
    tmdb.findByExternalId.mockResolvedValue({ tv_results: [{ id: 603 }], movie_results: [], person_results: [] });
    tmdb.tvDetails.mockResolvedValue({ next_episode_to_air: null });
    expect(await resolve(row('TVDB', 'series', '81189', ['episode']))).toEqual({ candidates: [], resolved: true });
  });
});

describe('a title saved by its TMDB/TVDB id, held by more than one instance', () => {
  it('reminds once, from the default instance (listed first), for a film in two Radarrs', async () => {
    const radarr4k = { getMovieById: vi.fn(), getCalendar: vi.fn(async () => []) };
    mocks.getRadarrClients.mockResolvedValue([{ connection: { id: 'rad-1' }, client: radarr }, { connection: { id: 'rad-4k' }, client: radarr4k }]);
    // The library lists the 4K copy first: the instance order decides, not the library's.
    mocks.library.mockResolvedValue(lib([{ id: 9, tmdbId: 603, instanceId: 'rad-4k' }, { id: 5, tmdbId: 603, instanceId: 'rad-1' }], []));
    radarr.getMovieById.mockResolvedValue({ id: 5, title: 'Film', digitalRelease: `${day(10)}T00:00:00Z` });
    radarr4k.getMovieById.mockResolvedValue({ id: 9, title: 'Film', digitalRelease: `${day(10)}T00:00:00Z` });

    const { candidates } = await resolve(row('TMDB', 'movie', '603', ['digital']));

    expect(candidates.map((c) => c.targetKey)).toEqual(['radarr:rad-1:5:digital']);
    expect(radarr4k.getMovieById).not.toHaveBeenCalled();
  });

  it('uses the first instance that has it when the default does not', async () => {
    mocks.library.mockResolvedValue(lib([], [{ id: 3, tvdbId: 81189, instanceId: 'son-2' }]));
    sonarr2.getCalendar.mockResolvedValue([calendarEp(21, 3, 4)]);
    expect((await resolve(row('TVDB', 'series', '81189', ['episode']))).candidates.map((c) => c.targetKey)).toEqual(['sonarr:son-2:21']);
  });

  it('reminds once per episode for a series in two Sonarrs', async () => {
    mocks.library.mockResolvedValue(lib([], [{ id: 3, tvdbId: 81189, instanceId: 'son-1' }, { id: 4, tvdbId: 81189, instanceId: 'son-2' }]));
    sonarr1.getCalendar.mockResolvedValue([calendarEp(21, 3, 4), calendarEp(22, 3, 11)]);
    sonarr2.getCalendar.mockResolvedValue([calendarEp(31, 4, 4), calendarEp(32, 4, 11)]);

    const { candidates } = await resolve(row('TVDB', 'series', '81189', ['episode']));

    expect(candidates.map((c) => c.targetKey)).toEqual(['sonarr:son-1:21', 'sonarr:son-1:22']);
    expect(sonarr2.getCalendar).not.toHaveBeenCalled();
  });
});

describe('an instance that did not answer', () => {
  it('keeps what the alert had rather than reading TMDB, while the library still loads', async () => {
    // The Radarr holding the film timed out: the library loads without it.
    mocks.library.mockResolvedValue({ movies: [], series: [], moviesComplete: false, seriesComplete: true });
    expect(await resolve(row('TMDB', 'movie', '603', ['digital']))).toEqual({ candidates: [], resolved: false });
    expect(tmdb.movieReleaseDates).not.toHaveBeenCalled();

    mocks.library.mockResolvedValue({ movies: [], series: [], moviesComplete: true, seriesComplete: false });
    expect(await resolve(row('TVDB', 'series', '81189', ['episode']))).toEqual({ candidates: [], resolved: false });
    expect(tmdb.findByExternalId).not.toHaveBeenCalled();
  });

  it('so its pending reminder is kept, not cancelled', async () => {
    mocks.library.mockResolvedValue({ movies: [], series: [], moviesComplete: false, seriesComplete: true });
    const alert = row('TMDB', 'movie', '603', ['digital']);
    const { candidates, resolved } = await resolve(alert);
    mocks.occFindMany.mockResolvedValue([{ id: 'p1', targetKey: 'radarr:rad-1:5:digital', notifyAt: new Date(Date.now() + 9 * DAY) }]);

    await upsertOccurrencesForAlert(alert, candidates, { resolved });

    expect(mocks.occUpdateMany).not.toHaveBeenCalled();
  });

  it('still reads TMDB when no Radarr is set up at all', async () => {
    mocks.getRadarrClients.mockResolvedValue([]);
    mocks.library.mockResolvedValue({ movies: [], series: [], moviesComplete: false, seriesComplete: false });
    tmdb.movieReleaseDates.mockResolvedValue({ id: 603, results: [releaseDates('US', [[4, day(20)]])] });
    expect((await resolve(row('TMDB', 'movie', '603', ['digital']))).candidates.map((c) => c.targetKey)).toEqual(['tmdb:movie:603:digital']);
  });
});

describe('the library in a refresh cycle', () => {
  it('is read once for every TMDB/TVDB alert in the cycle', async () => {
    tmdb.movieReleaseDates.mockResolvedValue({ id: 603, results: [] });
    tmdb.findByExternalId.mockResolvedValue({ tv_results: [], movie_results: [], person_results: [] });
    const ctx = createResolverContext();
    await resolveAlertOccurrencesResult(row('TMDB', 'movie', '603', ['digital']), ctx);
    await resolveAlertOccurrencesResult(row('TMDB', 'movie', '604', ['digital']), ctx);
    await resolveAlertOccurrencesResult(row('TVDB', 'series', '81189', ['episode']), ctx);
    expect(mocks.library).toHaveBeenCalledTimes(1);
  });
});

describe('a film due sooner than its notice', () => {
  it('is refused with a shorter-notice message, while the preview still offers a release reminder', async () => {
    // Out in two days, with a reminder a week before: it could never go off.
    tmdb.movieReleaseDates.mockResolvedValue({ id: 603, results: [releaseDates('US', [[4, day(2)]])] });
    expect(await resolve({ ...row('TMDB', 'movie', '603', ['digital']), offsetMinutes: 10_080 } as ScheduledAlert))
      .toEqual({ candidates: [], resolved: true, released: 'movie', tooSoon: true });

    mocks.inPost = true;
    const res = await createAlert(new NextRequest('http://helprr.test/api/scheduled-alerts', { method: 'POST', body: JSON.stringify({
      draft: { source: 'TMDB', externalId: '603', mediaType: 'movie', title: 'Film' },
      scheduleMode: 'release_relative', releaseTypes: ['digital'], offsetMinutes: 10_080,
    }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('This movie comes out sooner than the reminder\'s notice, so it would never go off. Pick a shorter notice or a custom date.');
    // An hour's notice still works.
    expect((await resolve({ ...row('TMDB', 'movie', '603', ['digital']), offsetMinutes: 60 } as ScheduledAlert)).candidates).toHaveLength(1);
  });
});

describe('a release already announced', () => {
  const alert = row('TMDB', 'movie', '603', ['digital']);
  const film = (releaseAt: Date) => [{
    targetKey: 'radarr:rad-1:5:digital', releaseKind: 'digital' as const, releaseAt, notifyAt: new Date(releaseAt.getTime() - 3_600_000), title: 'Film', body: 'Digital release',
  }];
  const at = (iso: string) => new Date(iso);

  it('is not armed again when its time moved by under a day (midnight UTC → 9:00 local on deploy day)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(at('2026-12-06T23:30:00Z'));
      // Sent at midnight UTC Dec 7 by the old rule; the new rule says 9:00 New York, Dec 7.
      mocks.occFindMany.mockResolvedValueOnce([{ targetKey: 'radarr:rad-1:5:digital', releaseAt: at('2026-12-07T00:00:00Z') }]);
      await upsertOccurrencesForAlert(alert, film(at('2026-12-07T14:00:00Z')), { resolved: true });
      expect(mocks.occUpsert).not.toHaveBeenCalled();
      expect(mocks.occFindMany.mock.calls[0][0].where).toMatchObject({ alertId: 'a1', status: 'sent' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('is armed when the release moved by more than a day, or another release is due', async () => {
    mocks.occFindMany.mockResolvedValueOnce([{ targetKey: 'radarr:rad-1:5:digital', releaseAt: new Date(Date.now() - 1 * DAY) }]);
    await upsertOccurrencesForAlert(alert, film(new Date(Date.now() + 2 * DAY)), { resolved: true });
    expect(mocks.occUpsert).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    mocks.occFindMany.mockResolvedValue([]);
    mocks.occFindMany.mockResolvedValueOnce([{ targetKey: 'radarr:rad-1:5:physical', releaseAt: new Date(Date.now() + 2 * DAY) }]);
    await upsertOccurrencesForAlert(alert, film(new Date(Date.now() + 2 * DAY)), { resolved: true });
    expect(mocks.occUpsert).toHaveBeenCalledOnce();
  });
});
