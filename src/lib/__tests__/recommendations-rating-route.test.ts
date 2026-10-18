import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), getRating: vi.fn(), setRating: vi.fn(), quota: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.auth }));
vi.mock('@/lib/recommendations/ratings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/recommendations/ratings')>()),
  getRating: mocks.getRating,
  setRating: mocks.setRating,
}));
vi.mock('@/lib/recommendations/engine', () => ({ invalidateRecommendations: vi.fn() }));
vi.mock('@/lib/recommendations/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/recommendations/events')>()),
  takeEventQuota: mocks.quota,
}));
vi.mock('@/lib/db', () => ({ prisma: {} }));

const { GET, PUT } = await import('@/app/api/recommendations/rating/route');

const put = (body: unknown) => PUT(new NextRequest('http://helprr.test/api/recommendations/rating', { method: 'PUT', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'me' } });
  mocks.getRating.mockResolvedValue('up');
  mocks.setRating.mockResolvedValue(undefined);
  mocks.quota.mockResolvedValue(true);
});

describe('/api/recommendations/rating', () => {
  it('reads the signed-in user\'s own rating', async () => {
    const res = await GET(new NextRequest('http://helprr.test/api/recommendations/rating?itemKey=tmdb:movie:1'));
    expect(await res.json()).toEqual({ rating: 'up' });
    expect(mocks.getRating).toHaveBeenCalledWith('me', 'tmdb:movie:1');
  });

  it('saves a rating for the signed-in user only', async () => {
    const res = await put({ itemKey: 'jf:abc-123', rating: 'love', genres: ['Drama'], userId: 'someone-else' });
    expect(res.status).toBe(200);
    expect(mocks.setRating).toHaveBeenCalledWith('me', 'jf:abc-123', 'love', ['Drama']);
  });

  it('clears a rating with null', async () => {
    await put({ itemKey: 'tmdb:tv:5', rating: null });
    expect(mocks.setRating).toHaveBeenCalledWith('me', 'tmdb:tv:5', null, undefined);
  });

  it.each([
    [{ itemKey: 'not-a-key', rating: 'up' }],
    [{ itemKey: 'tmdb:movie:1', rating: 'meh' }],
    [{ itemKey: 'tmdb:movie:1', rating: 'up', genres: ['x'.repeat(41)] }],
  ])('refuses %j', async (body) => {
    expect((await put(body)).status).toBe(400);
    expect(mocks.setRating).not.toHaveBeenCalled();
  });

  it('shares the event quota, and saves nothing once it is spent', async () => {
    mocks.quota.mockResolvedValue(false);
    const res = await put({ itemKey: 'tmdb:movie:603', rating: 'up' });
    expect(res.status).toBe(429);
    expect(mocks.quota).toHaveBeenCalledWith('me', 1);
    expect(mocks.setRating).not.toHaveBeenCalled();
  });

  it('needs the recommendations capability', async () => {
    mocks.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await put({ itemKey: 'tmdb:movie:1', rating: 'up' })).status).toBe(403);
    expect(mocks.auth).toHaveBeenCalledWith('recommendations.view');
  });
});
