import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  auth: vi.fn(),
  client: {
    getItem: vi.fn(),
    getSimilarItems: vi.fn(),
    getSpecialFeatures: vi.fn(),
    getLocalTrailers: vi.fn(),
    getMediaSegments: vi.fn(),
    getThemeMedia: vi.fn(),
    withReadSignal: vi.fn(),
  },
}));
vi.mock('@/lib/auth', () => ({ requireUserCapability: mocked.auth }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/service-helpers', () => ({
  getJellyfinClientForUser: async () => mocked.client,
  JellyfinNotLinkedError: class extends Error {},
}));

import { GET } from '@/app/api/jellyfin/catalog/items/[itemId]/route';

// What Jellyfin returns from an item endpoint that takes no field list.
const located = (id: string) => ({
  Id: id,
  Name: id,
  Type: 'Movie',
  Path: `/media/SECRET/${id}.mkv`,
  MediaSources: [{
    Id: id,
    Container: 'mkv',
    Size: 1,
    Bitrate: 2,
    Path: `https://remote.example/${id}?access_token=SECRET`,
    RequiredHttpHeaders: { Authorization: 'Bearer SECRET' },
  }],
});

beforeEach(() => {
  vi.resetAllMocks();
  mocked.auth.mockResolvedValue({ ok: true, user: { id: 'member' } });
  mocked.client.withReadSignal.mockReturnValue(mocked.client);
  mocked.client.getItem.mockResolvedValue(located('abc'));
  mocked.client.getSimilarItems.mockResolvedValue({ Items: [] });
  mocked.client.getSpecialFeatures.mockResolvedValue([located('special')]);
  mocked.client.getLocalTrailers.mockResolvedValue([located('trailer')]);
  mocked.client.getMediaSegments.mockResolvedValue({ Items: [] });
  mocked.client.getThemeMedia.mockResolvedValue({
    ThemeSongsResult: { Items: [located('song')] },
    ThemeVideosResult: { Items: [located('video')] },
    SoundtrackSongsResult: { Items: [located('soundtrack')] },
  });
});

describe('GET /api/jellyfin/catalog/items/[itemId]', () => {
  it('returns the item and its extras without where their files live', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/jellyfin/catalog/items/abc?expand=specials,trailers,theme'),
      { params: Promise.resolve({ itemId: 'abc' }) },
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text);

    expect(text).not.toContain('SECRET');
    expect(body.item).toEqual({
      Id: 'abc',
      Name: 'abc',
      Type: 'Movie',
      MediaSources: [{ Id: 'abc', Container: 'mkv', Size: 1, Bitrate: 2 }],
    });
    expect(body.specialFeatures.map((item: { Id: string }) => item.Id)).toEqual(['special']);
    expect(body.localTrailers.map((item: { Id: string }) => item.Id)).toEqual(['trailer']);
    expect(body.themeMedia.themeSongs.map((item: { Id: string }) => item.Id)).toEqual(['song']);
    expect(body.themeMedia.themeVideos.map((item: { Id: string }) => item.Id)).toEqual(['video']);
    expect(body.themeMedia.soundtrackSongs.map((item: { Id: string }) => item.Id)).toEqual(['soundtrack']);
  });
});
