import { beforeEach, describe, expect, it, vi } from 'vitest';

const gql = vi.hoisted(() => vi.fn());
vi.mock('@/lib/anilist-auth-client', () => ({ gqlRequestAuthenticated: gql }));

import {
  fetchMediaListCollection,
  MEDIA_LIST_COLLECTION_CACHE_ENDPOINT,
  type AniListListMediaSummary,
} from '@/lib/anilist-mutations';

// Exactly the fields of AniListListMediaSummary: the type check fails if the
// type gains or loses a field without this list following.
const SUMMARY: Required<AniListListMediaSummary> = {
  id: 1,
  title: { romaji: null, english: null, native: null },
  coverImage: { extraLarge: null, large: null, medium: null, color: null },
  bannerImage: null,
  format: null,
  status: null,
  episodes: null,
  chapters: null,
  volumes: null,
  averageScore: null,
  popularity: null,
  genres: null,
  seasonYear: null,
};

function mediaSelection(query: string): string {
  const match = /media\s*\{([\s\S]*?)\n\s*\}\n\s*\}\n\s*\}/.exec(query);
  if (!match) throw new Error('no media selection in query');
  return match[1];
}

function topLevelFields(selection: string): string[] {
  return selection.replace(/\{[^}]*\}/g, '').split(/\s+/).filter(Boolean).sort();
}

beforeEach(() => {
  gql.mockReset();
  gql.mockResolvedValue({ MediaListCollection: { lists: [] } });
});

describe('fetchMediaListCollection', () => {
  it('selects only the summary fields the library, rails, widget and signals read', async () => {
    await fetchMediaListCollection({ userId: 7, type: 'ANIME' });
    const selection = mediaSelection(gql.mock.calls[0][0] as string);

    expect(topLevelFields(selection)).toEqual(Object.keys(SUMMARY).sort());
    expect(selection).toContain('title { romaji english native }');
    expect(selection).toContain('coverImage { extraLarge large medium color }');
    for (const heavy of ['tags', 'externalLinks', 'studios', 'startDate', 'description']) {
      expect(selection).not.toContain(heavy);
    }
  });

  it('passes the status only when one is asked for', async () => {
    await fetchMediaListCollection({ userId: 7, type: 'ANIME' });
    await fetchMediaListCollection({ userId: 7, type: 'MANGA', status: 'PLANNING' });

    expect(gql.mock.calls[0][1]).toEqual({ userId: 7, type: 'ANIME' });
    expect(gql.mock.calls[1][1]).toEqual({ userId: 7, type: 'MANGA', status: 'PLANNING' });
  });

  it('caches under a new key, so Redis does not serve the old heavy shape', () => {
    expect(MEDIA_LIST_COLLECTION_CACHE_ENDPOINT).not.toBe('mediaListCollection');
  });
});
