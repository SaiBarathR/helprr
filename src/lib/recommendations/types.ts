export interface ForYouItem {
  /** TMDB id, used as widget key. */
  id: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year: number | null;
  /** Full https:// URL for a TMDB poster, or null. */
  posterPath: string | null;
  rating: number;
  overview: string;
  /** Short "Like Severance" reason, from the strongest seed. */
  reason: string;
  /** Deep-link target inside Helprr. Points to the discover detail page. */
  href: string;
}

export interface ForYouResponse {
  items: ForYouItem[];
  /** True when no seeds were available (e.g. neither Sonarr nor Radarr configured). */
  empty: boolean;
}
