import { describe, expect, it } from 'vitest';
import { arrEditHref, arrFilesHref, arrInteractiveSearchHref, arrManageHref } from '@/lib/arr-edit-href';

describe('arrEditHref', () => {
  it('builds movie edit href without instance', () => {
    expect(arrEditHref('movie', 11)).toBe('/movies/11/edit');
  });

  it('builds series edit href with instance', () => {
    expect(arrEditHref('series', 5, 'inst-abc')).toBe('/series/5/edit?instance=inst-abc');
  });

  it('builds music edit href', () => {
    expect(arrEditHref('music', 3, 'lid-1')).toBe('/music/3/edit?instance=lid-1');
  });
});

describe('arrManageHref', () => {
  it('includes title and instance for movies', () => {
    expect(arrManageHref('movie', 11, 'Inception', 'cmrkep2m')).toBe(
      '/movies/11/manage?title=Inception&instance=cmrkep2m',
    );
  });
});

describe('arrFilesHref', () => {
  it('builds music files href', () => {
    expect(arrFilesHref('music', 7, 'inst')).toBe('/music/7/files?instance=inst');
  });
});

describe('arrInteractiveSearchHref', () => {
  it('builds each kind of search page, with the title and instance', () => {
    expect(arrInteractiveSearchHref({ kind: 'movie', movieId: 11 }, 'Inception', 'rad-1'))
      .toBe('/movies/11/search?title=Inception&instance=rad-1');
    expect(arrInteractiveSearchHref({ kind: 'season', seriesId: 5, seasonNumber: 0 }, 'Severance - Specials'))
      .toBe('/series/5/season/0/search?title=Severance+-+Specials');
    expect(arrInteractiveSearchHref({ kind: 'episode', seriesId: 5, seasonNumber: 2, episodeId: 301 }, 'Severance - S02E01', 'son-1'))
      .toBe('/series/5/season/2/episode/301/search?title=Severance+-+S02E01&instance=son-1');
    expect(arrInteractiveSearchHref({ kind: 'album', albumId: 31 }, 'First Album', null))
      .toBe('/music/album/31/search?title=First+Album');
  });

  it('encodes a title that would otherwise break the query', () => {
    expect(arrInteractiveSearchHref({ kind: 'movie', movieId: 1 }, 'Tom & Jerry #2?', 'a b'))
      .toBe('/movies/1/search?title=Tom+%26+Jerry+%232%3F&instance=a+b');
  });
});
