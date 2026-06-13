import type { LibraryGapItem } from '@/types';

// How many searchable units (episodes/seasons/movies) one grouped gap card covers.
// Shared by the API (section `count` = unit total) and the page (truncation math), so
// the units-vs-card-groups distinction stays in one place and can't drift between them.
export function searchUnits(item: LibraryGapItem): number {
  if (item.search.kind === 'episodes') return item.search.episodeIds.length;
  if (item.search.kind === 'seasons') return item.search.seasonNumbers.length;
  return 1;
}
