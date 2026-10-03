import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  groupBy: vi.fn(),
  deleteMany: vi.fn(),
  movieDetails: vi.fn(),
  tvDetails: vi.fn(),
  getAnimeSummaries: vi.fn(),
  loadCachedArrLibrary: vi.fn(),
  forgetExcludedItems: vi.fn(),
  invalidateRecommendations: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({
  prisma: { recommendationEvent: { groupBy: mocks.groupBy, deleteMany: mocks.deleteMany } },
}));
vi.mock('@/lib/service-helpers', () => ({
  getTMDBClient: async () => ({ movieDetails: mocks.movieDetails, tvDetails: mocks.tvDetails }),
}));
vi.mock('@/lib/anilist-client', () => ({ getAnimeSummaries: mocks.getAnimeSummaries }));
vi.mock('@/lib/cache/arr-library', () => ({ loadCachedArrLibrary: mocks.loadCachedArrLibrary }));
vi.mock('@/lib/recommendations/profile-store', () => ({ forgetExcludedItems: mocks.forgetExcludedItems }));
vi.mock('@/lib/recommendations/engine', () => ({ invalidateRecommendations: mocks.invalidateRecommendations }));

import { listExcludedTitles, restoreExcludedTitle } from '@/lib/recommendations/excluded';
import { DELETE, GET } from '@/app/api/recommendations/excluded/route';

const at = (iso: string) => ({ _max: { createdAt: new Date(iso) } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: { id: 'user-1' }, session: {} });
  mocks.groupBy.mockResolvedValue([]);
  mocks.deleteMany.mockResolvedValue({ count: 0 });
  mocks.getAnimeSummaries.mockResolvedValue([]);
  mocks.loadCachedArrLibrary.mockResolvedValue({ movies: [], series: [] });
});

describe('listExcludedTitles', () => {
  it('lists each title once, newest first, with its latest reason', async () => {
    mocks.groupBy.mockResolvedValue([
      { itemKey: 'tmdb:movie:603', eventType: 'dislike', ...at('2026-09-01T00:00:00Z') },
      { itemKey: 'tmdb:movie:603', eventType: 'not_interested', ...at('2026-09-20T00:00:00Z') },
      { itemKey: 'anilist:21', eventType: 'not_interested', ...at('2026-09-10T00:00:00Z') },
    ]);
    mocks.movieDetails.mockResolvedValue({ title: 'The Matrix', release_date: '1999-03-31', poster_path: '/m.jpg' });
    mocks.getAnimeSummaries.mockResolvedValue([
      { id: 21, title: { english: 'One Piece', romaji: null, native: null }, coverImage: { large: 'op.jpg' }, seasonYear: 1999 },
    ]);

    const result = await listExcludedTitles('user-1');

    expect(mocks.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', eventType: { in: ['not_interested', 'dislike'] } },
    }));
    expect(result.total).toBe(2);
    expect(result.items.map((i) => [i.itemKey, i.reason])).toEqual([
      ['tmdb:movie:603', 'not_interested'],
      ['anilist:21', 'not_interested'],
    ]);
    expect(result.items[0]).toMatchObject({
      title: 'The Matrix',
      year: 1999,
      posterUrl: 'https://image.tmdb.org/t/p/w342/m.jpg',
      href: '/discover/movie/603',
      mediaType: 'movie',
    });
    expect(result.items[1]).toMatchObject({ title: 'One Piece', href: '/anime/21', mediaType: 'anime' });
  });

  it('still lists a title its source no longer knows', async () => {
    mocks.groupBy.mockResolvedValue([
      { itemKey: 'tmdb:tv:1399', eventType: 'dislike', ...at('2026-09-01T00:00:00Z') },
      { itemKey: 'jf:abc', eventType: 'not_interested', ...at('2026-08-01T00:00:00Z') },
    ]);
    mocks.tvDetails.mockRejectedValue(new Error('404'));

    const result = await listExcludedTitles('user-1');
    expect(result.items).toEqual([
      expect.objectContaining({ itemKey: 'tmdb:tv:1399', title: null, href: null, mediaType: 'tv' }),
      expect.objectContaining({ itemKey: 'jf:abc', title: null, href: null, mediaType: null }),
    ]);
  });

  it('names owned titles that have no TMDB id from the library', async () => {
    mocks.groupBy.mockResolvedValue([
      { itemKey: 'arr:sonarr:inst-1:7', eventType: 'not_interested', ...at('2026-09-01T00:00:00Z') },
    ]);
    mocks.loadCachedArrLibrary.mockResolvedValue({
      movies: [],
      series: [{ id: 7, instanceId: 'inst-1', title: 'Old Show', year: 2004, images: [{ coverType: 'poster', remoteUrl: 'p.jpg' }] }],
    });

    const result = await listExcludedTitles('user-1');
    expect(result.items[0]).toMatchObject({ title: 'Old Show', posterUrl: 'p.jpg', href: '/series/7?instance=inst-1' });
  });
});

describe('restoreExcludedTitle', () => {
  it("deletes only this user's exclude events, then clears the profile and cache", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 2 });

    await expect(restoreExcludedTitle('user-1', 'tmdb:movie:603')).resolves.toBe(2);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', itemKey: 'tmdb:movie:603', eventType: { in: ['not_interested', 'dislike'] } },
    });
    expect(mocks.forgetExcludedItems).toHaveBeenCalledWith('user-1', ['tmdb:movie:603']);
    expect(mocks.invalidateRecommendations).toHaveBeenCalledWith('user-1');
  });
});

describe('excluded route', () => {
  const del = (body: unknown) => new NextRequest('http://localhost/api/recommendations/excluded', {
    method: 'DELETE',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

  it('refuses users without the recommendations capability', async () => {
    const denied = new Response(null, { status: 403 });
    mocks.requireUserCapability.mockResolvedValue({ ok: false, response: denied });

    expect((await GET(new NextRequest('http://localhost/api/recommendations/excluded'))).status).toBe(403);
    expect((await DELETE(del({ itemKey: 'tmdb:movie:603' }))).status).toBe(403);
    expect(mocks.groupBy).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it('counts without looking titles up', async () => {
    mocks.groupBy.mockResolvedValue([{ itemKey: 'tmdb:movie:1' }, { itemKey: 'anilist:2' }]);

    const response = await GET(new NextRequest('http://localhost/api/recommendations/excluded?view=count'));
    expect(await response.json()).toEqual({ total: 2 });
    expect(mocks.movieDetails).not.toHaveBeenCalled();
    expect(mocks.getAnimeSummaries).not.toHaveBeenCalled();
  });

  it.each([
    ['bad JSON', '{'],
    ['missing itemKey', {}],
    ['malformed itemKey', { itemKey: 'movie:603' }],
  ])('rejects %s', async (_label, body) => {
    expect((await DELETE(del(body))).status).toBe(400);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("restores the caller's own title", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 });

    const response = await DELETE(del({ itemKey: 'anilist:21' }));
    expect(await response.json()).toEqual({ restored: true });
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ userId: 'user-1', itemKey: 'anilist:21' }),
    });
  });
});
