import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  getRadarrClient: vi.fn(),
  radarr: { getExtraFiles: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/service-helpers', () => ({ getRadarrClient: mocks.getRadarrClient }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { GET } from './route';

const get = (query: string) => GET(new NextRequest(`http://localhost/api/radarr/extrafile?${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: { id: 'u1' }, session: {} });
  mocks.getRadarrClient.mockResolvedValue(mocks.radarr);
  // Captured from a real Radarr 7 (13 Assassins), plus fields a later version might add.
  mocks.radarr.getExtraFiles.mockResolvedValue([
    { movieId: 299, movieFileId: 404, relativePath: '13 Assassins (2010) Unknown.eng.srt', extension: '.srt', languageTags: [], type: 'subtitle', id: 122 },
    { movieId: 299, movieFileId: 404, relativePath: '13 Assassins (2010) Unknown-poster.jpg', extension: '.jpg', type: 'metadata', id: 2982 },
    { movieId: 299, relativePath: 'notes.txt', type: 'weird', id: 7, path: '/data/movies/13 Assassins/notes.txt', languageTags: ['forced', 3] },
    { movieId: 299, type: 'other', id: 8 },
  ]);
});

describe('GET /api/radarr/extrafile', () => {
  it('needs movies.view', async () => {
    mocks.requireUserCapability.mockResolvedValueOnce({
      ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });
    expect((await get('movieId=299')).status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('movies.view');
    expect(mocks.getRadarrClient).not.toHaveBeenCalled();
  });

  it.each(['', 'movieId=0', 'movieId=-2', 'movieId=1.5', 'movieId=abc'])('rejects "%s"', async (query) => {
    expect((await get(query)).status).toBe(400);
    expect(mocks.getRadarrClient).not.toHaveBeenCalled();
  });

  it("asks the page's instance", async () => {
    await get('movieId=299&instanceId=rad-4k');
    expect(mocks.getRadarrClient).toHaveBeenCalledWith('rad-4k');
    expect(mocks.radarr.getExtraFiles).toHaveBeenCalledWith(299);
  });

  it('rebuilds each file from an allow-list', async () => {
    const response = await get('movieId=299');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: 122, movieFileId: 404, relativePath: '13 Assassins (2010) Unknown.eng.srt', extension: '.srt', type: 'subtitle' },
      { id: 2982, movieFileId: 404, relativePath: '13 Assassins (2010) Unknown-poster.jpg', extension: '.jpg', type: 'metadata' },
      { id: 7, relativePath: 'notes.txt', type: 'other', languageTags: ['forced'] },
    ]);
  });
});
