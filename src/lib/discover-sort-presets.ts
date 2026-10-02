/**
 * Discover's rating presets only rank titles with enough TMDB votes, so a
 * handful of 10/10 titles with two votes can't top the list. The API applies
 * these floors; the page names them so a short result list isn't a mystery.
 */
export const SORT_PRESET_VOTE_FLOOR: Record<string, number> = {
  highlyRated: 200,
  mostLoved: 1200,
};

/** Sections served from fixed TMDB lists, which ignore the sort presets. */
const LIST_SECTIONS = new Set(['now_playing', 'airing_today', 'top_rated_movies', 'top_rated_tv']);

/**
 * The rule a sort preset adds on top of the visible filters, or null when it
 * adds none. A vote filter at or above the preset's floor already shows as its
 * own chip, so the floor isn't repeated then.
 */
export function discoverSortPresetNote(sort: string, voteCountMin: string, section: string | null): string | null {
  if (section && LIST_SECTIONS.has(section)) return null;
  if (sort === 'upcoming') return 'Only titles that are not out yet';
  const floor = SORT_PRESET_VOTE_FLOOR[sort];
  if (!floor || (Number(voteCountMin) || 0) >= floor) return null;
  return `Only titles with ${floor.toLocaleString('en-US')}+ votes`;
}
