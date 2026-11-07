import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeHashRedis } from './helpers/fake-hash-redis';

const mocks = vi.hoisted(() => ({
  notifyEvent: vi.fn(async () => 1),
  fetchMoviePool: vi.fn(),
  fetchSeriesPool: vi.fn(),
  fetchUserWatchStatusMap: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/service-helpers', () => ({}));
// No real pushes: the invite goes through notifyEvent, which is mocked.
vi.mock('@/lib/notification-service', () => ({ notifyEvent: mocks.notifyEvent }));
vi.mock('@/lib/random-watch-pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/random-watch-pool')>()),
  fetchMoviePool: mocks.fetchMoviePool,
  fetchSeriesPool: mocks.fetchSeriesPool,
}));
vi.mock('@/lib/jellyfin-watch-status-map', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/jellyfin-watch-status-map')>()),
  fetchUserWatchStatusMap: mocks.fetchUserWatchStatusMap,
}));

import {
  TONIGHT_ENDED_TTL_MS,
  TONIGHT_TITLE_COUNT,
  TONIGHT_TTL_MS,
  allowTonightStart,
  buildTonightTitles,
  canJoinTonight,
  canViewTonightTitles,
  castTonightVote,
  claimTonightWinner,
  createTonightSession,
  endTonightSession,
  isTonightSessionId,
  joinTonightSession,
  loadTonightSession,
  newTonightSessionId,
  sendTonightInvites,
  tonightKey,
  tonightStatus,
  tonightView,
  type TonightRedis,
  type TonightState,
} from '@/lib/tonight-pick';
import type { TonightTitle } from '@/types/tonight';

const T0 = Date.parse('2026-11-07T20:00:00Z');

function title(i: number, mediaType: 'movie' | 'series' = 'movie'): TonightTitle {
  return {
    mediaType, id: i, instanceId: 'inst', title: `Title ${i}`, year: 2020, overview: null,
    posterUrl: null, backdropUrl: null, runtime: 100, genres: [], href: `/movies/${i}?instance=inst`,
    rating: null, imdbId: null, tmdbId: i, tvdbId: null,
  };
}

const member = (id: string, permissions: Record<string, boolean> = {}) => ({
  id, role: 'member' as const, template: 'member', permissions, status: 'active' as const, jellyfinUserId: `jf-${id}`,
});

let fake: FakeHashRedis;
let redis: TonightRedis;

async function start(invitedIds = ['sai', 'mum', 'dad'], count = 3): Promise<TonightState> {
  return createTonightSession(redis, {
    starterId: invitedIds[0],
    filters: { type: 'movie', watch: 'all' },
    invited: invitedIds.map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) })),
    titles: Array.from({ length: count }, (_, i) => title(i)),
    narrowed: false,
  });
}

async function reload(state: TonightState): Promise<TonightState> {
  return (await loadTonightSession(redis, state.meta.id))!;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  fake = new FakeHashRedis();
  redis = fake as unknown as TonightRedis;
  mocks.notifyEvent.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('session ids', () => {
  it('are 128-bit base64url and the only accepted shape', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newTonightSessionId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(isTonightSessionId(id)).toBe(true);
    expect(isTonightSessionId('abc')).toBe(false);
    expect(isTonightSessionId('../../etc/passwd/xxxxxx')).toBe(false);
    expect(isTonightSessionId(42)).toBe(false);
  });
});

describe('lifecycle', () => {
  it('creates an open session the starter has joined, with a 3 hour expiry', async () => {
    const state = await start();
    const loaded = await reload(state);
    expect(tonightStatus(loaded)).toBe('open');
    expect([...loaded.joined]).toEqual(['sai']);
    expect(fake.pTTL(tonightKey(state.meta.id))).toBe(TONIGHT_TTL_MS);
  });

  it('the first title everyone who joined says yes to wins', async () => {
    let state = await start();
    await joinTonightSession(redis, state, 'mum');
    state = await reload(state);
    state = await castTonightVote(redis, state, 'sai', 0, false);
    state = await castTonightVote(redis, state, 'sai', 1, true);
    state = await castTonightVote(redis, state, 'mum', 0, true);
    expect(tonightStatus(state)).toBe('open');
    state = await castTonightVote(redis, state, 'mum', 1, true);
    expect(tonightStatus(state)).toBe('matched');
    expect(tonightView(state, 'mum').winnerIndex).toBe(1);

    // Later votes cannot replace the winner.
    state = await castTonightVote(redis, state, 'sai', 2, true);
    expect(state.winner).toBe(1);
    expect(state.votes.get('sai')?.has(2)).toBe(false);
  });

  it('never matches with only one person in the pick', async () => {
    let state = await start();
    for (let i = 0; i < 3; i++) state = await castTonightVote(redis, state, 'sai', i, true);
    expect(tonightStatus(state)).toBe('open');
  });

  it('a late joiner must also say yes before a title wins', async () => {
    let state = await start();
    state = await castTonightVote(redis, state, 'sai', 0, true);
    await joinTonightSession(redis, state, 'mum');
    await joinTonightSession(redis, await reload(state), 'dad');
    state = await castTonightVote(redis, await reload(state), 'mum', 0, true);
    expect(tonightStatus(state)).toBe('open');
    state = await castTonightVote(redis, state, 'dad', 0, true);
    expect(state.winner).toBe(0);
  });

  it('repairs a win whose claim was lost between the vote and the claim', async () => {
    let state = await start();
    state = await castTonightVote(redis, state, 'sai', 1, true);
    state = await castTonightVote(redis, state, 'mum', 0, false);
    // Mum's yes lands, but the claim never runs (say the process stopped).
    await redis.multi().hSetNX(tonightKey(state.meta.id), 'vote:mum:1', '1').exec();
    state = await reload(state);
    expect(state.winner).toBeNull();
    state = await claimTonightWinner(redis, state);
    expect(tonightStatus(state)).toBe('matched');
    expect(state.winner).toBe(1);
  });

  it('when two titles race, the first claim stands', async () => {
    let state = await start();
    await joinTonightSession(redis, state, 'mum');
    state = await reload(state);
    state = await castTonightVote(redis, state, 'sai', 0, true);
    state = await castTonightVote(redis, state, 'sai', 1, true);
    state = await castTonightVote(redis, state, 'mum', 0, true);
    // A second claim from stale state cannot replace it.
    await redis.multi().hSetNX(tonightKey(state.meta.id), 'winner', '1').exec();
    expect((await reload(state)).winner).toBe(0);
  });

  it('votes are final', async () => {
    let state = await start();
    state = await castTonightVote(redis, state, 'sai', 0, false);
    state = await castTonightVote(redis, state, 'sai', 0, true);
    expect(state.votes.get('sai')?.get(0)).toBe(false);
  });

  it('ends with no match once every title has a no from someone', async () => {
    let state = await start();
    state = await castTonightVote(redis, state, 'sai', 0, true);
    state = await castTonightVote(redis, state, 'mum', 0, false);
    state = await castTonightVote(redis, state, 'mum', 1, true);
    state = await castTonightVote(redis, state, 'sai', 1, false);
    expect(tonightStatus(state)).toBe('open');
    state = await castTonightVote(redis, state, 'dad', 2, false);
    expect(tonightStatus(state)).toBe('noMatch');
    const view = tonightView(state, 'sai');
    expect(view.nearMisses).toEqual([{ index: 0, yes: 1 }, { index: 1, yes: 1 }]);
    // Nobody can vote once it is over.
    const after = await castTonightVote(redis, state, 'dad', 0, true);
    expect(after.votes.get('dad')?.has(0)).toBe(false);
  });

  it('shows each person their own votes and only counts for the others', async () => {
    let state = await start();
    state = await castTonightVote(redis, state, 'sai', 0, true);
    state = await castTonightVote(redis, state, 'mum', 1, false);
    const view = tonightView(state, 'mum');
    expect(view.myVotes).toEqual({ 1: false });
    expect(view.participants.find((p) => p.id === 'sai')).toMatchObject({ joined: true, voted: 1, isStarter: true });
    expect(view.participants.find((p) => p.id === 'dad')).toMatchObject({ joined: false, voted: 0 });
    expect(view.isStarter).toBe(false);
    expect(view.starterName).toBe('Sai');
  });
});

describe('TTL and cleanup', () => {
  it('the whole session disappears when it expires', async () => {
    const state = await start();
    vi.setSystemTime(T0 + TONIGHT_TTL_MS + 1);
    expect(await loadTonightSession(redis, state.meta.id)).toBeNull();
    expect(fake.store.size).toBe(0);
  });

  it('a write racing the expiry does not leave a hash without a TTL', async () => {
    const state = await start();
    vi.setSystemTime(T0 + TONIGHT_TTL_MS + 1);
    await castTonightVote(redis, state, 'mum', 0, true);
    await joinTonightSession(redis, state, 'dad');
    expect(fake.store.size).toBe(0);
  });

  it('an ended pick stays readable for 15 minutes, then goes', async () => {
    let state = await start();
    vi.setSystemTime(T0 + 60_000);
    state = await endTonightSession(redis, state);
    expect(tonightStatus(await reload(state))).toBe('ended');
    expect(fake.pTTL(tonightKey(state.meta.id))).toBe(TONIGHT_ENDED_TTL_MS);
    // Joining an ended pick does not push the expiry back out.
    await joinTonightSession(redis, await reload(state), 'mum');
    expect(fake.pTTL(tonightKey(state.meta.id))).toBe(TONIGHT_ENDED_TTL_MS);
    vi.setSystemTime(T0 + 60_000 + TONIGHT_ENDED_TTL_MS + 1);
    expect(await loadTonightSession(redis, state.meta.id)).toBeNull();
  });

  it('a vote sent from state read before End does not stretch the 15 minutes back out', async () => {
    const stale = await start();
    await joinTonightSession(redis, stale, 'mum');
    const mumView = await reload(stale);
    vi.setSystemTime(T0 + 60_000);
    await endTonightSession(redis, await reload(stale));
    await castTonightVote(redis, mumView, 'mum', 0, true);
    await joinTonightSession(redis, stale, 'dad');
    expect(fake.pTTL(tonightKey(stale.meta.id))).toBe(TONIGHT_ENDED_TTL_MS);
  });

  it('limits how many picks one person can start in a fixed ten minute window', async () => {
    for (let i = 0; i < 6; i++) {
      vi.setSystemTime(T0 + i * 60_000);
      expect(await allowTonightStart(redis, 'sai')).toBe(true);
    }
    expect(await allowTonightStart(redis, 'sai')).toBe(false);
    expect(await allowTonightStart(redis, 'mum')).toBe(true);
    // Retrying does not push the window out: it still ends ten minutes after the first start.
    vi.setSystemTime(T0 + 9 * 60_000);
    expect(await allowTonightStart(redis, 'sai')).toBe(false);
    vi.setSystemTime(T0 + 10 * 60_000 + 1);
    expect(await allowTonightStart(redis, 'sai')).toBe(true);
  });
});

describe('permissions', () => {
  it('only active people with Random and view rights can join', () => {
    expect(canJoinTonight(member('a'), 'movie')).toBe(true);
    expect(canJoinTonight(member('a', { 'random.view': false }), 'any')).toBe(false);
    expect(canJoinTonight({ ...member('a'), status: 'disabled' as never }, 'any')).toBe(false);
    expect(canJoinTonight(member('a', { 'movies.view': false }), 'movie')).toBe(false);
    expect(canJoinTonight(member('a', { 'movies.view': false }), 'any')).toBe(true);
  });

  it('re-checks view rights for every kind of title in the session', async () => {
    const state = await start();
    expect(canViewTonightTitles(member('mum'), state)).toBe(true);
    expect(canViewTonightTitles(member('mum', { 'movies.view': false }), state)).toBe(false);
    expect(canViewTonightTitles(member('mum', { 'random.view': false }), state)).toBe(false);
    // Series rights do not matter for a movies-only pick.
    expect(canViewTonightTitles(member('mum', { 'series.view': false }), state)).toBe(true);
  });
});

describe('the shared pool', () => {
  const movie = (id: number) => ({ id, instanceId: 'r1', title: `M${id}`, hasFile: true, images: [], genres: [], imdbId: `tt${id}`, tmdbId: id });
  const show = (id: number) => ({ id, instanceId: 's1', title: `S${id}`, images: [], genres: [], imdbId: '', tmdbId: 0, tvdbId: id * 10, statistics: { episodeFileCount: 1 } });
  const watched = (keys: string[]) => ({
    items: [{ kind: 'movie', played: true, playedPercentage: 100 }],
    keys: Object.fromEntries(keys.map((k) => [k, 0])),
  });

  beforeEach(() => {
    mocks.fetchMoviePool.mockResolvedValue([movie(1), movie(2), movie(3)]);
    mocks.fetchSeriesPool.mockResolvedValue([show(4)]);
    mocks.fetchUserWatchStatusMap.mockReset();
  });

  it('leaves out a kind of title someone may not view, and says the pool narrowed', async () => {
    const { titles, narrowed } = await buildTonightTitles(member('sai'), [member('mum', { 'series.view': false })], { type: 'any', watch: 'all' });
    expect(titles.map((t) => t.mediaType).sort()).toEqual(['movie', 'movie', 'movie']);
    expect(narrowed).toBe(true);
  });

  it('with Unwatched, keeps only titles nobody has watched', async () => {
    mocks.fetchUserWatchStatusMap.mockImplementation(async (u: { id: string }) =>
      u.id === 'sai' ? watched(['radarr:r1:1']) : watched(['radarr:r1:2']));
    const { titles, narrowed } = await buildTonightTitles(member('sai'), [member('mum')], { type: 'movie', watch: 'unwatched' });
    expect(titles.map((t) => t.id)).toEqual([3]);
    expect(titles[0]).toMatchObject({ imdbId: 'tt3', tmdbId: 3, tvdbId: null });
    expect(narrowed).toBe(true);
  });

  it('is not narrowed when everyone sees the same titles', async () => {
    const { titles, narrowed } = await buildTonightTitles(member('sai'), [member('mum')], { type: 'any', watch: 'all' });
    expect(titles).toHaveLength(4);
    expect(titles.find((t) => t.mediaType === 'series')).toMatchObject({ tvdbId: 40, imdbId: null, tmdbId: null });
    expect(narrowed).toBe(false);
  });

  it('a watch state that cannot be read does not filter that person', async () => {
    mocks.fetchUserWatchStatusMap.mockRejectedValue(new Error('Jellyfin down'));
    const { titles } = await buildTonightTitles(member('sai'), [member('mum')], { type: 'movie', watch: 'unwatched' });
    expect(titles).toHaveLength(3);
  });

  it('keeps only titles in a chosen genre and length; a pick started before them is unfiltered', async () => {
    mocks.fetchMoviePool.mockResolvedValue([
      { ...movie(1), genres: ['Comedy'], runtime: 95 },
      { ...movie(2), genres: ['Drama'], runtime: 100 },
      { ...movie(3), genres: ['Comedy', 'Drama'], runtime: 150 },
    ]);
    mocks.fetchSeriesPool.mockResolvedValue([{ ...show(4), genres: ['Comedy'], runtime: 25 }]);
    const ids = async (filters: Parameters<typeof buildTonightTitles>[2]) =>
      (await buildTonightTitles(member('sai'), [member('mum')], filters)).titles.map((t) => t.id).sort();
    expect(await ids({ type: 'any', watch: 'all', genres: ['Comedy'], runtime: 'any' })).toEqual([1, 3, 4]);
    expect(await ids({ type: 'any', watch: 'all', genres: ['Comedy'], runtime: '90to120' })).toEqual([1]);
    // A series is matched by its episode length.
    expect(await ids({ type: 'any', watch: 'all', genres: [], runtime: 'under90' })).toEqual([4]);
    expect(await ids({ type: 'any', watch: 'all' })).toEqual([1, 2, 3, 4]);
  });

  it(`deals at most ${TONIGHT_TITLE_COUNT} titles`, async () => {
    mocks.fetchMoviePool.mockResolvedValue(Array.from({ length: 60 }, (_, i) => movie(i + 1)));
    const { titles } = await buildTonightTitles(member('sai'), [member('mum')], { type: 'movie', watch: 'all' });
    expect(titles).toHaveLength(TONIGHT_TITLE_COUNT);
    expect(new Set(titles.map((t) => t.id)).size).toBe(TONIGHT_TITLE_COUNT);
  });
});

describe('invites', () => {
  it('sends one owned push per invitee through notifyEvent, not to the starter', async () => {
    const state = await start(['sai', 'mum', 'dad']);
    await sendTonightInvites(state);
    expect(mocks.notifyEvent).toHaveBeenCalledTimes(2);
    expect(mocks.notifyEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'tonightPickInvite',
      title: 'Sai started a movie pick',
      url: `/recommendations?mode=random&tonight=${state.meta.id}`,
      userIds: ['mum'],
      ownerUserId: 'mum',
      dedupeKey: `${state.meta.id}:mum`,
    }));
  });

  it('a failed push does not fail the start', async () => {
    mocks.notifyEvent.mockRejectedValueOnce(new Error('db down'));
    const state = await start();
    await expect(sendTonightInvites(state)).resolves.toBeUndefined();
  });
});
