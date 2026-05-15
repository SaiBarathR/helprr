export type TmdbCarouselId =
  | 'trending'
  | 'trending-movies'
  | 'trending-tv'
  | 'popular-all'
  | 'popular-movies'
  | 'popular-series'
  | 'upcoming-movies'
  | 'upcoming-series'
  | 'top-rated-movies'
  | 'top-rated-tv'
  | 'now-playing'
  | 'airing-today';

export type TmdbCarouselMediaHint = 'movie' | 'tv' | 'mixed';

export interface TmdbCarouselItem {
  id: TmdbCarouselId;
  label: string;
  /** Matches the `key` of the section returned by `/api/discover?mode=sections`. */
  sectionKey: string;
  mediaTypeHint: TmdbCarouselMediaHint;
}

export const TMDB_CAROUSEL_MAP: Record<TmdbCarouselId, TmdbCarouselItem> = {
  'trending': { id: 'trending', label: 'Trending', sectionKey: 'trending', mediaTypeHint: 'mixed' },
  'trending-movies': { id: 'trending-movies', label: 'Trending Movies', sectionKey: 'trending_movies', mediaTypeHint: 'movie' },
  'trending-tv': { id: 'trending-tv', label: 'Trending TV', sectionKey: 'trending_tv', mediaTypeHint: 'tv' },
  'popular-all': { id: 'popular-all', label: 'Popular', sectionKey: 'popular_all', mediaTypeHint: 'mixed' },
  'popular-movies': { id: 'popular-movies', label: 'Popular Movies', sectionKey: 'popular_movies', mediaTypeHint: 'movie' },
  'popular-series': { id: 'popular-series', label: 'Popular Series', sectionKey: 'popular_series', mediaTypeHint: 'tv' },
  'upcoming-movies': { id: 'upcoming-movies', label: 'Upcoming Movies', sectionKey: 'upcoming_movies', mediaTypeHint: 'movie' },
  'upcoming-series': { id: 'upcoming-series', label: 'Upcoming Series', sectionKey: 'upcoming_series', mediaTypeHint: 'tv' },
  'top-rated-movies': { id: 'top-rated-movies', label: 'Top Rated Movies', sectionKey: 'top_rated_movies', mediaTypeHint: 'movie' },
  'top-rated-tv': { id: 'top-rated-tv', label: 'Top Rated TV', sectionKey: 'top_rated_tv', mediaTypeHint: 'tv' },
  'now-playing': { id: 'now-playing', label: 'Now in Theaters', sectionKey: 'now_playing', mediaTypeHint: 'movie' },
  'airing-today': { id: 'airing-today', label: 'Airing Today', sectionKey: 'airing_today', mediaTypeHint: 'tv' },
};

export const DEFAULT_TMDB_CAROUSEL_ORDER: TmdbCarouselId[] = [
  'trending',
  'trending-movies',
  'trending-tv',
  'popular-all',
  'popular-movies',
  'popular-series',
  'upcoming-movies',
  'upcoming-series',
  'top-rated-movies',
  'top-rated-tv',
  'now-playing',
  'airing-today',
];
