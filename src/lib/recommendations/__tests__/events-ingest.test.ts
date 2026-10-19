import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  count: vi.fn(), createMany: vi.fn(), replaceRating: vi.fn(), forgetInProfile: vi.fn(), invalidate: vi.fn(), exec: vi.fn(), redis: vi.fn(),
}));
const tx = vi.hoisted(() => ({} as Record<string, unknown>));
vi.mock('@/lib/db', () => {
  Object.assign(tx, { recommendationEvent: { createMany: mocks.createMany } });
  return { prisma: { recommendationEvent: { count: mocks.count }, $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } };
});
vi.mock('@/lib/redis', () => ({ getRedisClient: mocks.redis }));
vi.mock('../engine', () => ({ invalidateRecommendations: mocks.invalidate }));
vi.mock('../ratings', () => ({ RATING_OF: { dislike: 'down', like: 'up', love: 'love' }, replaceRating: mocks.replaceRating, forgetInProfile: mocks.forgetInProfile }));

const { ingestEvents, recordRequestEvent } = await import('../events');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.count.mockResolvedValue(0);
  let submitted = 0;
  mocks.redis.mockResolvedValue({
    multi: () => {
      const chain = { incrBy: (_key: string, n: number) => { submitted = n; return chain; }, expire: () => chain, exec: () => mocks.exec(submitted) };
      return chain;
    },
  });
  mocks.exec.mockImplementation(async (n: number) => [n, true]);
  mocks.replaceRating.mockImplementation(async (_tx: unknown, _u: string, itemKey: string, rating: string) => ({ itemKey, liked: rating === 'down', excluded: rating !== 'down' }));
});

// The feed's and rec cards' thumbs are ratings too: they replace the title's
// previous rating, so "latest wins" holds for every writer.
describe('ingestEvents', () => {
  it('replaces ratings and stores the other events in one transaction, then invalidates once', async () => {
    const result = await ingestEvents('u1', [
      { itemKey: 'tmdb:movie:2', eventType: 'click', railId: 'trending' },
      { itemKey: 'tmdb:movie:9', eventType: 'love' },
      { itemKey: 'tmdb:movie:1', eventType: 'dislike', railId: 'because-you-watched', context: { mode: 'feed' } },
    ]);
    expect(result).toEqual({ ok: true, stored: 3 });
    // In title order, inside the batch's transaction.
    expect(mocks.replaceRating.mock.calls).toEqual([
      [tx, 'u1', 'tmdb:movie:1', 'down', undefined, { railId: 'because-you-watched', context: { mode: 'feed' } }],
      [tx, 'u1', 'tmdb:movie:9', 'love', undefined, { railId: undefined, context: undefined }],
    ]);
    expect(mocks.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ itemKey: 'tmdb:movie:2', eventType: 'click' })] });
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });

  it('edits the profile once, after every title lock of the batch, with each title\'s last change', async () => {
    await ingestEvents('u1', [
      { itemKey: 'tmdb:movie:1', eventType: 'like' },
      { itemKey: 'tmdb:movie:1', eventType: 'dislike' },
      { itemKey: 'tmdb:movie:5', eventType: 'love' },
    ]);
    expect(mocks.forgetInProfile).toHaveBeenCalledTimes(1);
    expect(mocks.forgetInProfile.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...mocks.replaceRating.mock.invocationCallOrder));
    expect(mocks.forgetInProfile).toHaveBeenCalledWith(tx, 'u1', [
      { itemKey: 'tmdb:movie:1', liked: true, excluded: false },
      { itemKey: 'tmdb:movie:5', liked: false, excluded: true },
    ]);
  });

  it('commits nothing, and invalidates nothing, when one rating in the batch fails', async () => {
    mocks.replaceRating.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('lock timeout'));
    await expect(ingestEvents('u1', [
      { itemKey: 'tmdb:movie:1', eventType: 'dislike' },
      { itemKey: 'tmdb:movie:1', eventType: 'love' },
      { itemKey: 'tmdb:movie:2', eventType: 'click' },
    ])).rejects.toThrow('lock timeout');
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it('counts submitted events, which replaced ratings do not reduce', async () => {
    mocks.exec.mockResolvedValue([1001, true]);
    expect(await ingestEvents('u1', [{ itemKey: 'tmdb:tv:3', eventType: 'like' }])).toEqual({ ok: false, rateLimited: true });
    expect(mocks.replaceRating).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it('counts submissions in the process without Redis, so re-rating one title still reaches the limit', async () => {
    mocks.redis.mockRejectedValue(new Error('down'));
    const like = [{ itemKey: 'tmdb:tv:3', eventType: 'like' as const }];
    for (let i = 0; i < 1000; i += 1) expect(await ingestEvents('u-local', like)).toEqual({ ok: true, stored: 1 });
    expect(await ingestEvents('u-local', like)).toEqual({ ok: false, rateLimited: true });
    expect(mocks.count).not.toHaveBeenCalled();
    // Another user has their own count.
    expect(await ingestEvents('u-other', like)).toEqual({ ok: true, stored: 1 });
  });
});

describe('recordRequestEvent', () => {
  it("stores a request as the title's TMDB key, a plain signal that leaves the rails cached", async () => {
    expect(await recordRequestEvent('u1', 'tv', 1399)).toEqual({ ok: true, stored: 1 });
    expect(mocks.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: 'u1', itemKey: 'tmdb:tv:1399', eventType: 'request' })],
    });
    expect(mocks.replaceRating).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
