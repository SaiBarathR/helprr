import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  count: vi.fn(), createMany: vi.fn(), replaceRating: vi.fn(), invalidate: vi.fn(), incrBy: vi.fn(), expire: vi.fn(), redis: vi.fn(),
}));
const tx = vi.hoisted(() => ({} as Record<string, unknown>));
vi.mock('@/lib/db', () => {
  Object.assign(tx, { recommendationEvent: { createMany: mocks.createMany } });
  return { prisma: { recommendationEvent: { count: mocks.count }, $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } };
});
vi.mock('@/lib/redis', () => ({ getRedisClient: mocks.redis }));
vi.mock('../engine', () => ({ invalidateRecommendations: mocks.invalidate }));
vi.mock('../ratings', () => ({ RATING_OF: { dislike: 'down', like: 'up', love: 'love' }, replaceRating: mocks.replaceRating }));

const { ingestEvents } = await import('../events');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.count.mockResolvedValue(0);
  mocks.redis.mockResolvedValue({ incrBy: mocks.incrBy, expire: mocks.expire });
  mocks.incrBy.mockImplementation(async (_key: string, n: number) => n);
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
    mocks.incrBy.mockResolvedValue(1001);
    expect(await ingestEvents('u1', [{ itemKey: 'tmdb:tv:3', eventType: 'like' }])).toEqual({ ok: false, rateLimited: true });
    expect(mocks.replaceRating).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it('falls back to counting stored events without Redis', async () => {
    mocks.redis.mockRejectedValue(new Error('down'));
    mocks.count.mockResolvedValue(1000);
    expect(await ingestEvents('u1', [{ itemKey: 'tmdb:tv:3', eventType: 'click' }])).toEqual({ ok: false, rateLimited: true });
  });
});
