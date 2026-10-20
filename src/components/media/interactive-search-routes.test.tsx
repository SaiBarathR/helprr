// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  search: '',
  props: null as null | Record<string, unknown>,
}));
vi.mock('next/navigation', () => ({
  useParams: () => mocks.params,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock('@/components/media/interactive-search', () => ({
  InteractiveSearch: (props: Record<string, unknown>) => {
    mocks.props = props;
    return null;
  },
}));

import MoviePage from '@/app/(app)/movies/[id]/search/page';
import SeasonPage from '@/app/(app)/series/[id]/season/[seasonNumber]/search/page';
import EpisodePage from '@/app/(app)/series/[id]/season/[seasonNumber]/episode/[episodeId]/search/page';
import AlbumPage from '@/app/(app)/music/album/[albumId]/search/page';

afterEach(() => {
  cleanup();
  mocks.props = null;
});

function renderRoute(Page: () => React.ReactNode, params: Record<string, string>, search: string) {
  mocks.params = params;
  mocks.search = search;
  render(<Page />);
  return mocks.props;
}

describe('interactive search routes', () => {
  it('searches a movie on its instance', () => {
    expect(renderRoute(MoviePage, { id: '11' }, 'title=The+Sheep+Detectives&instance=rad-1')).toEqual({
      service: 'radarr',
      subtitle: 'The Sheep Detectives',
      searchParams: { movieId: '11', instanceId: 'rad-1' },
    });
  });

  it('searches a whole season, with the Season Pack filter', () => {
    expect(renderRoute(SeasonPage, { id: '3', seasonNumber: '0' }, 'title=Show+-+Specials&instance=son-2')).toEqual({
      service: 'sonarr',
      subtitle: 'Show - Specials',
      searchParams: { seriesId: '3', seasonNumber: '0', instanceId: 'son-2' },
      showSeasonPackFilter: true,
    });
  });

  it('searches one episode by its id, without the Season Pack filter', () => {
    expect(renderRoute(EpisodePage, { id: '3', seasonNumber: '1', episodeId: '22' }, 'title=Show+-+S01E01&instance=son-2')).toEqual({
      service: 'sonarr',
      subtitle: 'Show - S01E01',
      searchParams: { episodeId: '22', instanceId: 'son-2' },
    });
  });

  it('searches an album, on the default instance when none is given', () => {
    expect(renderRoute(AlbumPage, { albumId: '31' }, 'title=DAWN')).toEqual({
      service: 'lidarr',
      subtitle: 'DAWN',
      searchParams: { albumId: '31' },
    });
  });

  it('names the item generically when the link carried no title', () => {
    expect(renderRoute(MoviePage, { id: '11' }, '')?.subtitle).toBe('Movie');
    expect(renderRoute(SeasonPage, { id: '3', seasonNumber: '2' }, '')?.subtitle).toBe('Season 2');
    expect(renderRoute(EpisodePage, { id: '3', seasonNumber: '1', episodeId: '22' }, '')?.subtitle).toBe('Episode');
    expect(renderRoute(AlbumPage, { albumId: '31' }, '')?.subtitle).toBe('Album');
  });
});
