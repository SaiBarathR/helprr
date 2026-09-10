import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ auth: vi.fn(), client: { getLibraries: vi.fn(), getResumeItems: vi.fn(), getNextUp: vi.fn(), getCatalogItems: vi.fn(), getRecentlyAdded: vi.fn(), getUpcoming: vi.fn(), getMovieRecommendations: vi.fn(), getItem: vi.fn(), getSeasons: vi.fn(), getSeriesEpisodes: vi.fn(), getSimilarItems: vi.fn(), getSpecialFeatures: vi.fn(), getLocalTrailers: vi.fn(), getMediaSegments: vi.fn(), withReadSignal: vi.fn() } }));
vi.mock('@/lib/auth', () => ({ requireUserCapability: mocked.auth }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/service-helpers', () => ({ getJellyfinUserContext: async () => ({ client: mocked.client, connectionFingerprint: 'server', jellyfinUserId: 'jf-user' }), getJellyfinClientForUser: async () => mocked.client, JellyfinNotLinkedError: class extends Error {} }));
import { GET as home } from '@/app/api/jellyfin/catalog/home/route';
import { GET as detail } from '@/app/api/jellyfin/catalog/items/[itemId]/route';
import { invalidateJellyfinCatalog } from '@/lib/cache/jellyfin-catalog';
beforeEach(() => {
  vi.resetAllMocks(); invalidateJellyfinCatalog('route-test');
  mocked.auth.mockResolvedValue({ ok: true, user: { id: 'route-test' } });
  mocked.client.withReadSignal.mockReturnValue(mocked.client);
  mocked.client.getLibraries.mockResolvedValue([{ Id: 'abc', Name: 'Library' }]);
  mocked.client.getResumeItems.mockResolvedValue({ Items: [] });
  mocked.client.getNextUp.mockResolvedValue({ Items: [] });
  mocked.client.getCatalogItems.mockResolvedValue({ Items: [] });
  mocked.client.getRecentlyAdded.mockResolvedValue([{ Id: 'def', Name: 'Item' }]);
  mocked.client.getItem.mockResolvedValue({ Id: 'abc', Type: 'Series' });
});
describe('independent Watch reads', () => {
  it('returns core content without starting slow optional fan-out', async () => {
    mocked.client.getMovieRecommendations.mockImplementation(() => new Promise(() => {}));
    const response = await home(new NextRequest('http://localhost/api/jellyfin/catalog/home?section=core'));
    expect(response.status).toBe(200);
    expect((await response.json()).views).toHaveLength(1);
    expect(mocked.client.getRecentlyAdded).not.toHaveBeenCalled();
    expect(mocked.client.getMovieRecommendations).not.toHaveBeenCalled();
  });
  it('never accumulates latest sections across requests', async () => {
    const request = () => new NextRequest('http://localhost/api/jellyfin/catalog/home?section=latest&libraryId=abc');
    expect((await (await home(request())).json()).latest).toHaveLength(1);
    expect((await (await home(request())).json()).latest).toHaveLength(1);
  });
  it('does not expand a series when only core detail was requested', async () => {
    const response = await detail(new NextRequest('http://localhost/api/jellyfin/catalog/items/abc?expand='), { params: Promise.resolve({ itemId: 'abc' }) });
    expect(response.status).toBe(200);
    expect(mocked.client.getSeasons).not.toHaveBeenCalled();
    expect(mocked.client.getSeriesEpisodes).not.toHaveBeenCalled();
    expect(mocked.client.getSimilarItems).not.toHaveBeenCalled();
  });
  it('bounds episode reads to an explicitly requested season page', async () => {
    mocked.client.getItem.mockResolvedValue({ Id: 'abc', Type: 'Season', SeriesId: 'def' });
    mocked.client.getSeriesEpisodes.mockResolvedValue({ Items: [{ Id: 'one' }], TotalRecordCount: 120 });
    const response = await detail(new NextRequest('http://localhost/api/jellyfin/catalog/items/abc?expand=episodes&episodeLimit=50&episodeStart=50'), { params: Promise.resolve({ itemId: 'abc' }) });
    expect(mocked.client.getSeriesEpisodes).toHaveBeenCalledWith('def', 'abc', { startIndex: 50, limit: 50 });
    expect((await response.json()).episodesTotal).toBe(120);
  });
  it('authenticates before a warm cached read', async () => {
    await home(new NextRequest('http://localhost/api/jellyfin/catalog/home?section=core'));
    mocked.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await home(new NextRequest('http://localhost/api/jellyfin/catalog/home?section=core'))).status).toBe(401);
  });
});
