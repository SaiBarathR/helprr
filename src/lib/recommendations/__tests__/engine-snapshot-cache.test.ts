import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const counters = new Map<string, string>();
  return {
    store,
    counters,
    feedback: [] as { itemKey: string; eventType: string }[],
    discoveryGate: null as Promise<void> | null,
    compose: vi.fn(),
    redis: {
      get: vi.fn(async (key: string) => counters.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        counters.set(key, value);
        return 'OK';
      }),
    },
    cachingEnabled: true,
  };
});

vi.mock('@/lib/db', () => ({
  prisma: {
    recommendationEvent: { findMany: vi.fn(async () => [...mocks.feedback]) },
    userSettings: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock('@/lib/redis', () => ({ getRedisClient: async () => mocks.redis }));
vi.mock('@/lib/cache/json-cache', () => ({
  getCachedJson: vi.fn(async (scope: string, seed: string) => mocks.store.get(`${scope}:${seed}`) ?? null),
  setCachedJson: vi.fn(async (scope: string, seed: string, value: unknown) => { mocks.store.set(`${scope}:${seed}`, value); }),
  deleteCachedJson: vi.fn(async (scope: string, seed: string) => { mocks.store.delete(`${scope}:${seed}`); }),
}));
vi.mock('@/lib/cache/state', () => ({
  getCacheImagesEnabled: vi.fn(async () => mocks.cachingEnabled),
  tryAcquireCacheLock: vi.fn(async () => 'lock'),
  releaseCacheLock: vi.fn(async () => undefined),
}));
vi.mock('@/lib/service-helpers', () => ({
  getJellyfinUserContext: vi.fn(async () => { throw new Error('no jellyfin'); }),
  isJellyfinUnavailable: () => true,
}));
vi.mock('../profile-store', () => ({
  getTasteProfile: vi.fn(async () => ({ sources: [], builtAt: 'now', anime: { signalMass: 0 }, listedAnilistIds: [] })),
}));
vi.mock('../candidates', () => ({
  buildLibraryCandidates: vi.fn(async () => ({ candidates: [], libraryItemKeys: new Set(), watchMap: null })),
  // Held open so a feedback event can arrive after the build has read feedback.
  buildTmdbDiscoveryCandidates: vi.fn(async () => { await mocks.discoveryGate; return []; }),
  buildAnimeCandidates: vi.fn(async () => []),
}));
vi.mock('../signals', () => ({ collectWatchlistSignals: vi.fn(async () => ({ itemKeys: new Set() })) }));
vi.mock('../compose-rails', () => ({ composeRecommendations: mocks.compose }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { getRecommendationRails, invalidateRecommendations } from '@/lib/recommendations/engine';
import { buildTmdbDiscoveryCandidates } from '../candidates';
import { setCachedJson } from '@/lib/cache/json-cache';

const user = { id: 'user-1', role: 'member' as const, jellyfinUserId: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.clear();
  mocks.counters.clear();
  mocks.feedback = [];
  mocks.discoveryGate = null;
  mocks.cachingEnabled = true;
  mocks.compose.mockReset();
  // The rails list whatever the build was told to exclude, so a test can see
  // which feedback a snapshot was built from.
  mocks.compose.mockImplementation(({ liveExcludedItemKeys }: { liveExcludedItemKeys: Set<string> }) => ({
    rails: [{ id: 'excluded', items: [...liveExcludedItemKeys] }],
    feed: [],
  }));
});

describe('recommendation snapshot cache', () => {
  it('serves a cached snapshot until feedback invalidates it', async () => {
    await getRecommendationRails(user);
    await getRecommendationRails(user);
    expect(mocks.compose).toHaveBeenCalledTimes(1);

    mocks.feedback.push({ itemKey: 'tmdb:movie:1', eventType: 'not_interested' });
    await invalidateRecommendations(user.id);
    const rails = await getRecommendationRails(user);

    expect(mocks.compose).toHaveBeenCalledTimes(2);
    expect(rails.rails[0]).toMatchObject({ items: ['tmdb:movie:1'] });
  });

  it('never serves a build that started before an invalidation', async () => {
    let release!: () => void;
    mocks.discoveryGate = new Promise<void>((resolve) => { release = resolve; });

    // A build reads feedback (none yet) and stalls on the discovery fetch.
    const stale = getRecommendationRails(user);
    await vi.waitFor(() => expect(buildTmdbDiscoveryCandidates).toHaveBeenCalled());

    // The user hides a title meanwhile; the event is stored and the cache invalidated.
    mocks.feedback.push({ itemKey: 'tmdb:movie:1', eventType: 'not_interested' });
    await invalidateRecommendations(user.id);

    // The old build finishes and saves.
    release();
    expect((await stale).rails[0]).toMatchObject({ items: [] });

    // The next read must be built from the new feedback, not the stale save.
    mocks.discoveryGate = null;
    const fresh = await getRecommendationRails(user);
    expect(fresh.rails[0]).toMatchObject({ items: ['tmdb:movie:1'] });
    expect(mocks.compose).toHaveBeenCalledTimes(2);
  });

  it('builds without the cache when the generation cannot be read', async () => {
    await getRecommendationRails(user); // cached at the first generation
    mocks.feedback.push({ itemKey: 'tmdb:movie:1', eventType: 'not_interested' });
    await invalidateRecommendations(user.id);
    vi.mocked(setCachedJson).mockClear();

    // A read that cannot reach the counter must not fall back to the old snapshot.
    mocks.redis.get.mockRejectedValueOnce(new Error('redis blip'));
    const rails = await getRecommendationRails(user);

    expect(rails.rails[0]).toMatchObject({ items: ['tmdb:movie:1'] });
    expect(setCachedJson).not.toHaveBeenCalled();
  });

  it('never returns to a generation it used, whatever happened to the key', async () => {
    const key = 'helprr:cache:recommendations:generation:user-1';
    const used: string[] = [];
    for (let i = 0; i < 5; i++) {
      await invalidateRecommendations(user.id);
      used.push(mocks.counters.get(key)!);
    }
    mocks.counters.set(key, 'tampered');
    await invalidateRecommendations(user.id);
    used.push(mocks.counters.get(key)!);
    mocks.counters.delete(key);
    // A failed attempt is retried.
    mocks.redis.set.mockRejectedValueOnce(new Error('connection reset'));
    await invalidateRecommendations(user.id);
    used.push(mocks.counters.get(key)!);

    expect(new Set(used).size).toBe(7);
    expect(used).not.toContain('initial');
  });

  it('builds directly, without Redis, when caching is off', async () => {
    mocks.cachingEnabled = false;
    await getRecommendationRails(user);
    await getRecommendationRails(user);

    expect(mocks.compose).toHaveBeenCalledTimes(2);
    expect(mocks.redis.get).not.toHaveBeenCalled();
  });
});
