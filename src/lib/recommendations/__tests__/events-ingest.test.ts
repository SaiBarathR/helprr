import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ count: vi.fn(), createMany: vi.fn(), setRating: vi.fn(), invalidate: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { recommendationEvent: { count: mocks.count, createMany: mocks.createMany } } }));
vi.mock('../engine', () => ({ invalidateRecommendations: mocks.invalidate }));
vi.mock('../ratings', () => ({ RATING_OF: { dislike: 'down', like: 'up', love: 'love' }, setRating: mocks.setRating }));

const { ingestEvents } = await import('../events');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.count.mockResolvedValue(0);
});

// The feed's and rec cards' thumbs are ratings too: they replace the title's
// previous rating through setRating, so "latest wins" holds for every writer.
describe('ingestEvents', () => {
  it('sends likes, dislikes and loves through setRating, keeping their rail and context', async () => {
    const result = await ingestEvents('u1', [
      { itemKey: 'tmdb:movie:1', eventType: 'dislike', railId: 'because-you-watched', context: { mode: 'feed' } },
      { itemKey: 'tmdb:movie:2', eventType: 'click', railId: 'trending' },
    ]);
    expect(result).toEqual({ ok: true, stored: 2 });
    expect(mocks.setRating).toHaveBeenCalledWith('u1', 'tmdb:movie:1', 'down', undefined, { railId: 'because-you-watched', context: { mode: 'feed' } });
    expect(mocks.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ itemKey: 'tmdb:movie:2', eventType: 'click' })] });
  });

  it('writes nothing through createMany when every event is a rating', async () => {
    await ingestEvents('u1', [{ itemKey: 'tmdb:tv:3', eventType: 'like' }]);
    expect(mocks.setRating).toHaveBeenCalledWith('u1', 'tmdb:tv:3', 'up', undefined, { railId: undefined, context: undefined });
    expect(mocks.createMany).not.toHaveBeenCalled();
  });
});
