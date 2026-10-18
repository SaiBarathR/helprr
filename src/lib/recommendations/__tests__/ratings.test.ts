import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(), deleteMany: vi.fn(), create: vi.fn(), count: vi.fn(), executeRaw: vi.fn(),
  forgetExcludedItems: vi.fn(), forgetLikedItems: vi.fn(), invalidateRecommendations: vi.fn(),
}));
const tx = vi.hoisted(() => ({} as Record<string, unknown>));
vi.mock('@/lib/db', () => {
  const recommendationEvent = { findFirst: mocks.findFirst, deleteMany: mocks.deleteMany, create: mocks.create, count: mocks.count };
  Object.assign(tx, { recommendationEvent, $executeRaw: mocks.executeRaw });
  return { prisma: { recommendationEvent, $transaction: (fn: (t: unknown) => unknown) => fn(tx) } };
});
vi.mock('@/lib/recommendations/profile-store', () => ({ forgetExcludedItems: mocks.forgetExcludedItems, forgetLikedItems: mocks.forgetLikedItems }));
vi.mock('@/lib/recommendations/engine', () => ({ invalidateRecommendations: mocks.invalidateRecommendations }));

const { forgetInProfile, getRating, setRating } = await import('@/lib/recommendations/ratings');

const RATING_TYPES = { in: ['dislike', 'like', 'love'] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.count.mockResolvedValue(0);
});

describe('getRating', () => {
  it('reads the latest rating event for the title', async () => {
    mocks.findFirst.mockResolvedValue({ eventType: 'love' });
    expect(await getRating('u1', 'tmdb:movie:1')).toBe('love');
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', itemKey: 'tmdb:movie:1', eventType: RATING_TYPES },
      orderBy: { createdAt: 'desc' },
    }));
    mocks.findFirst.mockResolvedValue(null);
    expect(await getRating('u1', 'tmdb:movie:1')).toBeNull();
  });
});

describe('setRating', () => {
  it('replaces the previous rating so the latest wins', async () => {
    await setRating('u1', 'tmdb:movie:1', 'up', ['Drama']);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', itemKey: 'tmdb:movie:1', eventType: RATING_TYPES } });
    expect(mocks.create).toHaveBeenCalledWith({ data: { userId: 'u1', itemKey: 'tmdb:movie:1', eventType: 'like', context: { genres: ['Drama'] } } });
    expect(mocks.invalidateRecommendations).toHaveBeenCalledWith('u1');
  });

  it('takes a per-title lock before replacing, so overlapping saves leave one rating', async () => {
    await setRating('u1', 'tmdb:movie:1', 'up');
    const [strings, lockKey] = mocks.executeRaw.mock.calls[0];
    expect(strings.join('?')).toContain('pg_advisory_xact_lock');
    expect(lockKey).toBe('u1:tmdb:movie:1');
    expect(mocks.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteMany.mock.invocationCallOrder[0]);
  });

  it('stops boosting a title once its like is taken back, in the same transaction', async () => {
    await setRating('u1', 'tmdb:movie:1', 'down');
    expect(mocks.forgetLikedItems).toHaveBeenCalledWith('u1', ['tmdb:movie:1'], tx);
    vi.clearAllMocks();
    await setRating('u1', 'tmdb:movie:1', null);
    expect(mocks.forgetLikedItems).toHaveBeenCalledWith('u1', ['tmdb:movie:1'], tx);
    vi.clearAllMocks();
    await setRating('u1', 'tmdb:movie:1', 'love');
    expect(mocks.forgetLikedItems).not.toHaveBeenCalled();
  });

  it('stores a thumbs-down as a dislike and leaves the exclude in place', async () => {
    await setRating('u1', 'tmdb:tv:2', 'down');
    expect(mocks.create).toHaveBeenCalledWith({ data: { userId: 'u1', itemKey: 'tmdb:tv:2', eventType: 'dislike' } });
    expect(mocks.forgetExcludedItems).not.toHaveBeenCalled();
  });

  it('lets a cleared thumbs-down back into recommendations', async () => {
    await setRating('u1', 'tmdb:tv:2', null);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.forgetExcludedItems).toHaveBeenCalledWith('u1', ['tmdb:tv:2'], tx);
  });

  it('keeps the title excluded while "Not interested" still holds it', async () => {
    mocks.count.mockResolvedValue(1);
    await setRating('u1', 'tmdb:tv:2', 'love');
    expect(mocks.create).toHaveBeenCalledWith({ data: { userId: 'u1', itemKey: 'tmdb:tv:2', eventType: 'love' } });
    expect(mocks.count).toHaveBeenCalledWith({ where: { userId: 'u1', itemKey: 'tmdb:tv:2', eventType: { in: ['dislike', 'not_interested'] } } });
    expect(mocks.forgetExcludedItems).not.toHaveBeenCalled();
  });
});

describe('forgetInProfile', () => {
  it('drops each title once, liked and excluded keys apart', async () => {
    await forgetInProfile(tx as never, 'u1', [
      { itemKey: 'a', liked: true, excluded: false },
      { itemKey: 'b', liked: true, excluded: true },
      { itemKey: 'a', liked: true, excluded: false },
    ]);
    expect(mocks.forgetLikedItems).toHaveBeenCalledWith('u1', ['a', 'b'], tx);
    expect(mocks.forgetExcludedItems).toHaveBeenCalledWith('u1', ['b'], tx);
  });
});
