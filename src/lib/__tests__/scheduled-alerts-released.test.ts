import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AxiosError, AxiosHeaders } from 'axios';
import type { ScheduledAlert } from '@prisma/client';

/**
 * A release reminder on a film or an episode already out could never go off:
 * the save refuses it and the preview opens it on a custom date, from the same
 * verdict (the moment the resolver stops reminding of that release).
 */

const mocks = vi.hoisted(() => ({
  getRadarrClients: vi.fn(),
  getSonarrClients: vi.fn(),
  create: vi.fn(),
  inPost: false,
  alertFindFirst: vi.fn(),
  alertUpdate: vi.fn(),
  occFindMany: vi.fn(),
}));

vi.mock('@/lib/service-helpers', () => ({
  getSonarrClients: mocks.getSonarrClients,
  getRadarrClients: mocks.getRadarrClients,
  getLidarrClients: async () => [],
}));
vi.mock('@/lib/anilist-client', () => ({ getAnimeNextAiringEpisode: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUserCapability: vi.fn(async () => ({ ok: true, user: { id: 'u1', role: 'admin' } })) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/app-settings', async (importOriginal) => ({ ...(await importOriginal<object>()), getOrCreateAppSettings: async () => ({ timeZone: 'UTC' }) }));
vi.mock('@/lib/db', () => ({
  prisma: {
    userSettings: { findUnique: async () => null },
    // POST stops here once its checks pass.
    $transaction: async (fn: unknown) => {
      if (typeof fn !== 'function') throw new Error('unexpected batch');
      if (mocks.inPost) { mocks.create(); throw new Error('stop after the checks'); }
      const { prisma } = await import('@/lib/db');
      return fn(prisma);
    },
    scheduledAlert: { findFirst: mocks.alertFindFirst, update: mocks.alertUpdate, findUnique: async () => null },
    scheduledAlertOccurrence: {
      findMany: mocks.occFindMany, deleteMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(),
    },
  },
}));

import { createResolverContext, resolveAlertOccurrencesResult } from '@/lib/scheduled-alerts/resolver';
import { POST as createAlert } from '@/app/api/scheduled-alerts/route';
import { POST as previewAlert } from '@/app/api/scheduled-alerts/preview/route';
import { PATCH as editAlert } from '@/app/api/scheduled-alerts/[id]/route';

const DAY = 24 * 60 * 60 * 1000;
// Radarr's release dates are calendar days at midnight UTC.
const radarrDate = (offsetDays: number) => `${new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10)}T00:00:00Z`;
const notFound = () => new AxiosError('Request failed', undefined, undefined, undefined, {
  status: 404, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: null,
});

const radarr = { getMovieById: vi.fn(), getCalendar: vi.fn() };
const sonarr = { getEpisodeById: vi.fn(), getCalendar: vi.fn() };
const movie = (dates: { inCinemas?: string; digitalRelease?: string; physicalRelease?: string }) => ({ id: 5, title: 'Film', year: 2026, ...dates });
const episode = (airDateUtc: string | undefined, seriesId = 3) => ({ id: 11, seriesId, seasonNumber: 1, episodeNumber: 2, title: 'Two', airDateUtc, series: { title: 'Show' } });

const movieDraft = {
  source: 'RADARR', externalId: '5', mediaType: 'movie', title: 'Film', instanceId: 'rad-1', href: '/movies/5?instance=rad-1',
};
const episodeDraft = {
  source: 'SONARR', externalId: '3', mediaType: 'series', title: 'Show', subtitle: 'S01E02 - Two', instanceId: 'son-1',
  href: '/series/3/season/1/episode/11?instance=son-1', seasonNumber: 1, episodeId: 11,
};

const alertRow = (overrides: Record<string, unknown>) => ({
  id: 'a1', userId: 'u1', scheduleMode: 'release_relative', posterUrl: null, href: null, metadata: {}, offsetMinutes: 0,
  timeZone: 'UTC', status: 'active', cancelledAt: null, createdAt: new Date(), updatedAt: new Date(), subtitle: null,
  ...overrides,
}) as unknown as ScheduledAlert;
const movieRow = (releaseTypes: string[], overrides: Record<string, unknown> = {}) => alertRow({
  source: 'RADARR', mediaType: 'movie', externalId: '5', title: 'Film', instanceId: 'rad-1', scope: 'movie', releaseTypes, ...overrides,
});
const episodeRow = (overrides: Record<string, unknown> = {}) => alertRow({
  source: 'SONARR', mediaType: 'series', externalId: '3', title: 'Show', instanceId: 'son-1', scope: 'episode',
  releaseTypes: ['episode'], metadata: { seasonNumber: 1, episodeId: 11 }, ...overrides,
});

const post = (handler: (r: NextRequest) => Promise<Response>, path: string, body: unknown) =>
  handler(new NextRequest(`http://helprr.test${path}`, { method: 'POST', body: JSON.stringify(body) }));
const patch = (body: unknown) => editAlert(
  new NextRequest('http://helprr.test/api/scheduled-alerts/a1', { method: 'PATCH', body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: 'a1' }) },
);

beforeEach(() => {
  vi.clearAllMocks();
  // A queued once-value left by one test must not answer for the next.
  sonarr.getEpisodeById.mockReset();
  radarr.getMovieById.mockReset();
  mocks.inPost = false;
  radarr.getCalendar.mockResolvedValue([]);
  sonarr.getCalendar.mockResolvedValue([]);
  mocks.getRadarrClients.mockResolvedValue([{ connection: { id: 'rad-1', label: 'Radarr' }, client: radarr }]);
  mocks.getSonarrClients.mockResolvedValue([{ connection: { id: 'son-1', label: 'Sonarr' }, client: sonarr }]);
  mocks.occFindMany.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe('a film already out', () => {
  const resolve = (releaseTypes: string[]) => resolveAlertOccurrencesResult(movieRow(releaseTypes), createResolverContext());

  it('is flagged once every release asked for has passed', async () => {
    radarr.getMovieById.mockResolvedValue(movie({ inCinemas: radarrDate(-200), digitalRelease: radarrDate(-130), physicalRelease: radarrDate(-100) }));
    expect(await resolve(['digital'])).toEqual({ candidates: [], resolved: true, released: 'movie' });
    expect(await resolve(['digital', 'physical', 'cinema'])).toMatchObject({ released: 'movie' });
  });

  it('is not flagged while a release asked for is ahead, or has no date before the film is out at home', async () => {
    radarr.getMovieById.mockResolvedValue(movie({ digitalRelease: radarrDate(10) }));
    expect(await resolve(['digital'])).not.toHaveProperty('released');

    // In cinemas now, digital date not known yet: Radarr may learn it.
    radarr.getMovieById.mockResolvedValue(movie({ inCinemas: radarrDate(-5) }));
    expect(await resolve(['digital'])).not.toHaveProperty('released');
    expect(await resolve(['cinema'])).toMatchObject({ released: 'movie' });

    // Out digitally, disc ahead: a disc reminder still goes off.
    radarr.getMovieById.mockResolvedValue(movie({ digitalRelease: radarrDate(-20), physicalRelease: radarrDate(20) }));
    expect(await resolve(['digital', 'physical'])).not.toHaveProperty('released');
    expect(await resolve(['digital'])).toMatchObject({ released: 'movie' });
  });

  it('treats a release with no date as not coming once the film is out at home', async () => {
    radarr.getMovieById.mockResolvedValue(movie({ digitalRelease: radarrDate(-20) }));
    expect(await resolve(['physical'])).toMatchObject({ released: 'movie' });
  });

  it('is not judged for a film Radarr no longer has', async () => {
    radarr.getMovieById.mockRejectedValue(notFound());
    expect(await resolve(['digital'])).toEqual({ candidates: [], resolved: true });
  });

  it('is refused on save with a clear message, and a custom date is still taken', async () => {
    mocks.inPost = true;
    radarr.getMovieById.mockResolvedValue(movie({ digitalRelease: radarrDate(-130) }));

    const res = await post(createAlert, '/api/scheduled-alerts', { draft: movieDraft, scheduleMode: 'release_relative', releaseTypes: ['digital'] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('This movie is already out, so a release reminder would never go off. Pick a custom date instead.');
    expect(mocks.create).not.toHaveBeenCalled();

    const absoluteNotifyAt = new Date(Date.now() + DAY).toISOString();
    await expect(post(createAlert, '/api/scheduled-alerts', { draft: movieDraft, scheduleMode: 'absolute', absoluteNotifyAt })).rejects.toThrow('stop after the checks');
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it('opens on a custom date from tomorrow in the preview', async () => {
    radarr.getMovieById.mockResolvedValue(movie({ digitalRelease: radarrDate(-130) }));
    const body = await (await post(previewAlert, '/api/scheduled-alerts/preview', { draft: { ...movieDraft, releaseDate: radarrDate(-130) } })).json();
    expect(body).toMatchObject({ released: 'movie', defaults: { scope: 'movie', scheduleMode: 'absolute' } });
    expect(new Date(body.defaults.absoluteNotifyAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('offers its disc release in the preview when only that is ahead', async () => {
    radarr.getMovieById.mockResolvedValue(movie({ digitalRelease: radarrDate(-20), physicalRelease: radarrDate(20) }));
    const body = await (await post(previewAlert, '/api/scheduled-alerts/preview', { draft: { ...movieDraft, releaseDate: radarrDate(-20) } })).json();
    expect(body).not.toHaveProperty('released');
    expect(body.defaults).toMatchObject({ scheduleMode: 'release_relative', releaseTypes: ['physical'] });
    expect(body.candidates).toMatchObject([{ releaseKind: 'physical' }]);
  });

  it('keeps digital in the preview with no candidate when Radarr has no digital date, not the page\'s own date', async () => {
    // The movie page sends its cinema date as the draft's: the save would find
    // no digital date, so the preview must not count one.
    radarr.getMovieById.mockResolvedValue(movie({ inCinemas: radarrDate(20) }));
    const body = await (await post(previewAlert, '/api/scheduled-alerts/preview', { draft: { ...movieDraft, releaseDate: radarrDate(20) } })).json();
    expect(body).not.toHaveProperty('released');
    expect(body).not.toHaveProperty('tooSoon');
    expect(body.defaults).toMatchObject({ scheduleMode: 'release_relative', releaseTypes: ['digital'] });
    expect(body.candidates).toEqual([]);

    // Radarr unreachable: the page's date is all there is to show.
    mocks.getRadarrClients.mockResolvedValue([]);
    const offline = await (await post(previewAlert, '/api/scheduled-alerts/preview', { draft: { ...movieDraft, releaseDate: radarrDate(20) } })).json();
    expect(offline.candidates).toHaveLength(1);
  });

  it('is out from 9:00 on its release day in the person\'s time zone, for the preview and the save alike', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    radarr.getMovieById.mockResolvedValue(movie({ digitalRelease: '2026-11-13T00:00:00Z' }));
    const draft = { ...movieDraft, releaseDate: '2026-11-13T00:00:00Z' };
    const timeZone = 'Asia/Kolkata'; // 9:00 there is 03:30 UTC

    vi.setSystemTime(new Date('2026-11-13T03:00:00Z'));
    const before = await (await post(previewAlert, '/api/scheduled-alerts/preview', { draft, timeZone, offsetMinutes: 0 })).json();
    expect(before).not.toHaveProperty('released');
    expect(before.defaults.scheduleMode).toBe('release_relative');
    expect(before.candidates).toMatchObject([{ releaseKind: 'digital', notifyAt: '2026-11-13T03:30:00.000Z' }]);

    vi.setSystemTime(new Date('2026-11-13T04:00:00Z'));
    const after = await (await post(previewAlert, '/api/scheduled-alerts/preview', { draft, timeZone })).json();
    expect(after).toMatchObject({ released: 'movie', defaults: { scheduleMode: 'absolute' } });
    mocks.inPost = true;
    expect((await post(createAlert, '/api/scheduled-alerts', { draft, timeZone, scheduleMode: 'release_relative', releaseTypes: ['digital'], offsetMinutes: 0 })).status).toBe(400);
  });

  it('reminds of a film at 9:00 on each release day in the alert\'s time zone, not at midnight UTC', async () => {
    radarr.getMovieById.mockResolvedValue(movie({ digitalRelease: radarrDate(10), physicalRelease: radarrDate(40) }));
    const { candidates } = await resolveAlertOccurrencesResult(movieRow(['digital', 'physical'], { timeZone: 'America/New_York' }), createResolverContext());
    expect(candidates.map((c) => c.releaseKind)).toEqual(['digital', 'physical']);
    for (const c of candidates) {
      expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }).format(c.releaseAt!)).toBe('09:00');
    }
    expect(candidates[0].releaseAt?.toISOString().slice(0, 10)).toBe(radarrDate(10).slice(0, 10));
  });

  it('refuses an edit to releases that have all passed, or into a release reminder', async () => {
    radarr.getMovieById.mockResolvedValue(movie({ digitalRelease: radarrDate(-20), physicalRelease: radarrDate(20) }));

    mocks.alertFindFirst.mockResolvedValue(movieRow(['physical']));
    const res = await patch({ scheduleMode: 'release_relative', releaseTypes: ['digital'] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^This movie is already out/);

    mocks.alertFindFirst.mockResolvedValue(movieRow(['digital'], { scheduleMode: 'absolute' }));
    expect((await patch({ scheduleMode: 'release_relative', releaseTypes: ['digital'] })).status).toBe(400);
    expect(mocks.alertUpdate).not.toHaveBeenCalled();
  });

  it('lets an edit that keeps the releases and the notice through, such as a new title', async () => {
    const existing = movieRow(['digital'], { offsetMinutes: 60 });
    mocks.alertFindFirst.mockResolvedValue(existing);
    mocks.alertUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...existing, ...data }));
    radarr.getMovieById.mockResolvedValue(movie({ digitalRelease: radarrDate(-20) }));

    expect((await patch({ scheduleMode: 'release_relative', releaseTypes: ['digital'], offsetMinutes: 60, title: 'Renamed' })).status).toBe(200);
    expect(mocks.alertUpdate).toHaveBeenCalledOnce();
  });

  it('does not re-check a rename that sends the same releases in another order, or the default for none', async () => {
    // Every release passed: a real re-check would refuse it.
    radarr.getMovieById.mockResolvedValue(movie({ digitalRelease: radarrDate(-20), physicalRelease: radarrDate(-10) }));
    for (const [stored, sent] of [[['physical', 'digital'], ['digital', 'physical']], [[], ['digital']]] as const) {
      const existing = movieRow([...stored], { offsetMinutes: 60 });
      mocks.alertFindFirst.mockResolvedValue(existing);
      mocks.alertUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...existing, ...data }));
      expect((await patch({ scheduleMode: 'release_relative', releaseTypes: [...sent], offsetMinutes: 60, title: 'Renamed' })).status).toBe(200);
    }
    // A real change of releases is still re-checked.
    mocks.alertFindFirst.mockResolvedValue(movieRow(['physical'], { offsetMinutes: 60 }));
    expect((await patch({ scheduleMode: 'release_relative', releaseTypes: ['digital'], offsetMinutes: 60 })).status).toBe(400);
  });

  it('refuses an edit whose longer notice would fall before now', async () => {
    // Out in two days: a week's notice could never go off, a day's still can.
    mocks.alertFindFirst.mockResolvedValue(movieRow(['digital'], { offsetMinutes: 60 }));
    radarr.getMovieById.mockResolvedValue(movie({ digitalRelease: radarrDate(2) }));

    const res = await patch({ scheduleMode: 'release_relative', releaseTypes: ['digital'], offsetMinutes: 10_080 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^This movie comes out sooner than the reminder's notice/);
    expect(mocks.alertUpdate).not.toHaveBeenCalled();
  });
});

describe('a release due sooner than its notice', () => {
  it('is judged on the time the reminder would go off, for films, episodes and albums alike', async () => {
    radarr.getMovieById.mockResolvedValue(movie({ digitalRelease: radarrDate(2) }));
    expect(await resolveAlertOccurrencesResult(movieRow(['digital'], { offsetMinutes: 10_080 }), createResolverContext()))
      .toEqual({ candidates: [], resolved: true, released: 'movie', tooSoon: true });
    expect(await resolveAlertOccurrencesResult(movieRow(['digital'], { offsetMinutes: 60 }), createResolverContext()))
      .not.toHaveProperty('released');

    // An episode airing in two hours with a day's notice is on the calendar, so Sonarr is not asked.
    sonarr.getCalendar.mockResolvedValue([episode(new Date(Date.now() + 2 * 3_600_000).toISOString())]);
    expect(await resolveAlertOccurrencesResult(episodeRow({ offsetMinutes: 1440 }), createResolverContext()))
      .toEqual({ candidates: [], resolved: true, released: 'episode', tooSoon: true });
  });

  it('keeps the preview on a release reminder, as a shorter notice would work', async () => {
    radarr.getMovieById.mockResolvedValue(movie({ digitalRelease: radarrDate(2) }));
    const body = await (await post(previewAlert, '/api/scheduled-alerts/preview', { draft: movieDraft, offsetMinutes: 10_080, scheduleMode: 'release_relative' })).json();
    expect(body).not.toHaveProperty('released');
    expect(body.defaults.scheduleMode).toBe('release_relative');
    // No candidate, though a date is known: the dialog says nothing of "no date".
    expect(body).toMatchObject({ candidates: [], tooSoon: true });
  });
});

describe('an episode already aired', () => {
  // As a save or an edit asks; a background refresh does not (see below).
  const resolve = (row = episodeRow()) => resolveAlertOccurrencesResult(row, createResolverContext(), { checkAired: true });

  it('is not looked up on a background refresh, which never uses the verdict', async () => {
    sonarr.getEpisodeById.mockResolvedValue(episode(new Date(Date.now() - DAY).toISOString()));
    expect(await resolveAlertOccurrencesResult(episodeRow(), createResolverContext())).toEqual({ candidates: [], resolved: true });
    expect(sonarr.getEpisodeById).not.toHaveBeenCalled();
  });


  it('is flagged from its air time, asking Sonarr only when the calendar does not have it', async () => {
    sonarr.getEpisodeById.mockResolvedValue(episode(new Date(Date.now() - DAY).toISOString()));
    expect(await resolve()).toEqual({ candidates: [], resolved: true, released: 'episode' });
    expect(sonarr.getEpisodeById).toHaveBeenCalledWith(11);

    sonarr.getEpisodeById.mockClear();
    sonarr.getCalendar.mockResolvedValue([episode(new Date(Date.now() + DAY).toISOString())]);
    const ahead = await resolve();
    expect(ahead).not.toHaveProperty('released');
    expect(ahead.candidates).toHaveLength(1);
    expect(sonarr.getEpisodeById).not.toHaveBeenCalled();
  });

  it('is not flagged when far ahead, undated, gone, or another series\' episode', async () => {
    sonarr.getEpisodeById.mockResolvedValueOnce(episode(new Date(Date.now() + 200 * DAY).toISOString()));
    expect(await resolve()).not.toHaveProperty('released');
    sonarr.getEpisodeById.mockResolvedValueOnce(episode(undefined));
    expect(await resolve()).not.toHaveProperty('released');
    sonarr.getEpisodeById.mockRejectedValueOnce(notFound());
    expect(await resolve()).toEqual({ candidates: [], resolved: true });
    sonarr.getEpisodeById.mockResolvedValueOnce(episode(new Date(Date.now() - DAY).toISOString(), 99));
    expect(await resolve()).not.toHaveProperty('released');
  });

  it('is never judged for a series or season alert', async () => {
    await resolve(episodeRow({ scope: 'series', metadata: {} }));
    await resolve(episodeRow({ scope: 'season', metadata: { seasonNumber: 1 } }));
    expect(sonarr.getEpisodeById).not.toHaveBeenCalled();
  });

  it('is refused on save with a clear message', async () => {
    mocks.inPost = true;
    sonarr.getEpisodeById.mockResolvedValue(episode(new Date(Date.now() - DAY).toISOString()));
    const res = await post(createAlert, '/api/scheduled-alerts', { draft: episodeDraft, scheduleMode: 'release_relative', releaseTypes: ['episode'] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('This episode has already aired, so a release reminder would never go off. Pick a custom date instead.');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('is out from its air time on the day, for the preview and the save alike', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const airsAt = '2026-11-13T20:00:00Z';
    sonarr.getEpisodeById.mockResolvedValue(episode(airsAt));
    sonarr.getCalendar.mockImplementation(async (start: string) => (new Date(start) < new Date(airsAt) ? [episode(airsAt)] : []));
    const draft = { ...episodeDraft, releaseDate: airsAt };

    vi.setSystemTime(new Date('2026-11-13T19:59:00Z'));
    const before = await (await post(previewAlert, '/api/scheduled-alerts/preview', { draft, offsetMinutes: 0 })).json();
    expect(before).not.toHaveProperty('released');
    expect(before.defaults).toMatchObject({ scope: 'episode', scheduleMode: 'release_relative' });

    vi.setSystemTime(new Date('2026-11-13T20:01:00Z'));
    const after = await (await post(previewAlert, '/api/scheduled-alerts/preview', { draft })).json();
    expect(after).toMatchObject({ released: 'episode', defaults: { scheduleMode: 'absolute' } });
    mocks.inPost = true;
    expect((await post(createAlert, '/api/scheduled-alerts', { draft, scheduleMode: 'release_relative', offsetMinutes: 0 })).status).toBe(400);
  });

  it('is too soon when Sonarr says it airs before the notice, though the calendar leaves it out (unmonitored)', async () => {
    // Sonarr's calendar lists monitored episodes only, so this one is looked up.
    sonarr.getEpisodeById.mockResolvedValue(episode(new Date(Date.now() + 2 * 3_600_000).toISOString()));
    expect(await resolve(episodeRow({ offsetMinutes: 1440 }))).toEqual({ candidates: [], resolved: true, released: 'episode', tooSoon: true });
    expect(sonarr.getEpisodeById).toHaveBeenCalledWith(11);
  });

  it('refuses an edit to an episode-scope alert on an episode already aired', async () => {
    // A series alert edited to remind of one episode, which aired yesterday.
    mocks.alertFindFirst.mockResolvedValue(episodeRow({ scope: 'series', metadata: {} }));
    sonarr.getEpisodeById.mockResolvedValue(episode(new Date(Date.now() - DAY).toISOString()));
    const res = await patch({ scope: 'episode', seasonNumber: 1, episodeId: 11 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^This episode has already aired/);
    expect(mocks.alertUpdate).not.toHaveBeenCalled();
  });

  it('refuses an edit of the time zone that moves a film\'s 9:00 reminder into the past', async () => {
    // Out today: 9:00 in Tokyo (00:00 UTC) has passed at 06:00 UTC, 9:00 in New York (14:00 UTC) has not.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-13T06:00:00Z'));
      radarr.getMovieById.mockResolvedValue(movie({ digitalRelease: '2026-11-13T00:00:00Z' }));
      mocks.alertFindFirst.mockResolvedValue(movieRow(['digital'], { timeZone: 'America/New_York', offsetMinutes: 0 }));
      expect((await patch({ timeZone: 'Asia/Tokyo' })).status).toBe(400);
      expect(mocks.alertUpdate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses an edit that turns its custom reminder into a release reminder', async () => {
    mocks.alertFindFirst.mockResolvedValue(episodeRow({ scheduleMode: 'absolute' }));
    sonarr.getEpisodeById.mockResolvedValue(episode(new Date(Date.now() - DAY).toISOString()));
    const res = await patch({ scheduleMode: 'release_relative', releaseTypes: ['episode'] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^This episode has already aired/);
    expect(mocks.alertUpdate).not.toHaveBeenCalled();
  });
});
