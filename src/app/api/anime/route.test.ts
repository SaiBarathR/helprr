import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ browseAnime: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUserCapability: vi.fn(async () => ({ ok: true, user: { id: 'user-1' } })) }));
vi.mock('@/lib/service-helpers', () => ({ loadTaggedLibrary: vi.fn(async () => ({ movies: [], series: [] })) }));
vi.mock('@/lib/anilist-client', () => ({ browseAnime: mocks.browseAnime, searchAnime: vi.fn(), maxAniListPage: () => 500 }));
vi.mock('@/lib/anime-library', () => ({ annotateAnimeItems: vi.fn(async () => []) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { GET } from './route';

const browse = (query: string) => GET(new NextRequest(`http://localhost/api/anime?mode=browse&sort=popularity&${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.browseAnime.mockResolvedValue({ media: [], pageInfo: null });
});

describe('GET /api/anime year range', () => {
  it('reads a range given high to low as the same years', async () => {
    expect((await browse('yearMin=2020&yearMax=2010')).status).toBe(200);
    expect(mocks.browseAnime).toHaveBeenCalledWith(expect.objectContaining({ yearGreater: 2010, yearLesser: 2020 }));
  });

  it('passes an ordered range and a single bound unchanged', async () => {
    await browse('yearMin=2010&yearMax=2015');
    expect(mocks.browseAnime).toHaveBeenLastCalledWith(expect.objectContaining({ yearGreater: 2010, yearLesser: 2015 }));
    await browse('yearMin=2020');
    expect(mocks.browseAnime).toHaveBeenLastCalledWith(expect.objectContaining({ yearGreater: 2020, yearLesser: undefined }));
  });
});
