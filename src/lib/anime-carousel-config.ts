/**
 * Configuration for anime home page carousels.
 * Each carousel has an id (used in Zustand state) and a label (used in settings UI).
 */

export type AnimeCarouselId =
  | 'continueWatching'
  | 'planToWatch'
  | 'trending'
  | 'popularThisSeason'
  | 'upcomingNextSeason'
  | 'allTimePopular'
  | 'top100';

export interface AnimeCarouselItem {
  id: AnimeCarouselId;
  label: string;
  /** If true, this carousel requires an AniList connection with data to show */
  requiresAniList?: boolean;
}

export const ANIME_CAROUSEL_MAP: Record<AnimeCarouselId, AnimeCarouselItem> = {
  continueWatching: { id: 'continueWatching', label: 'Continue Watching', requiresAniList: true },
  planToWatch: { id: 'planToWatch', label: 'Plan to Watch', requiresAniList: true },
  trending: { id: 'trending', label: 'Trending Now' },
  popularThisSeason: { id: 'popularThisSeason', label: 'Popular This Season' },
  upcomingNextSeason: { id: 'upcomingNextSeason', label: 'Upcoming Next Season' },
  allTimePopular: { id: 'allTimePopular', label: 'All Time Popular' },
  top100: { id: 'top100', label: 'Top 100' },
};

export const DEFAULT_ANIME_CAROUSEL_ORDER: AnimeCarouselId[] = [
  'continueWatching',
  'planToWatch',
  'trending',
  'popularThisSeason',
  'upcomingNextSeason',
  'allTimePopular',
  'top100',
];

/**
 * Reconcile the persisted carousel order with the canonical list.
 * Adds any missing carousels at the end, removes any unknown ones.
 */
export function reconcileAnimeCarouselOrder(
  persisted: AnimeCarouselId[]
): AnimeCarouselId[] {
  const known = new Set<AnimeCarouselId>(DEFAULT_ANIME_CAROUSEL_ORDER);
  // Keep only valid ids in their persisted order
  const result = persisted.filter((id) => known.has(id));
  // Append any new carousels that weren't in the persisted list
  const seen = new Set(result);
  for (const id of DEFAULT_ANIME_CAROUSEL_ORDER) {
    if (!seen.has(id)) result.push(id);
  }
  return result;
}
