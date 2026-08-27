/**
 * Rating strip derivation, shared by the arr detail pages and the Watch
 * detail page so the two surfaces can never disagree about a score.
 *
 * Radarr carries the full provider set; Sonarr exposes a single aggregate, so a
 * series strip is honestly one entry rather than a faked spread.
 */

export interface RatingItem {
  label: string;
  score: string;
  votes: number;
  /** Tailwind classes for the star glyph. */
  color: string;
}

export interface ArrRatingValue {
  votes: number;
  value: number;
}

export interface ArrMovieRatings {
  imdb?: ArrRatingValue;
  tmdb?: ArrRatingValue;
  metacritic?: ArrRatingValue;
  rottenTomatoes?: ArrRatingValue;
  trakt?: ArrRatingValue;
}

export function movieRatingItems(ratings: ArrMovieRatings | undefined | null): RatingItem[] {
  if (!ratings) return [];
  const items: RatingItem[] = [];
  if (ratings.imdb && ratings.imdb.value > 0) {
    items.push({ label: 'IMDb', score: ratings.imdb.value.toFixed(1), votes: ratings.imdb.votes, color: 'text-yellow-500 fill-yellow-500' });
  }
  if (ratings.tmdb && ratings.tmdb.value > 0) {
    items.push({ label: 'TMDb', score: ratings.tmdb.value.toFixed(1), votes: ratings.tmdb.votes, color: 'text-sky-500 fill-sky-500' });
  }
  if (ratings.metacritic && ratings.metacritic.value > 0) {
    items.push({ label: 'MC', score: String(Math.round(ratings.metacritic.value)), votes: ratings.metacritic.votes, color: 'text-emerald-500 fill-emerald-500' });
  }
  if (ratings.rottenTomatoes && ratings.rottenTomatoes.value > 0) {
    items.push({ label: 'RT', score: `${Math.round(ratings.rottenTomatoes.value)}%`, votes: ratings.rottenTomatoes.votes, color: 'text-red-500 fill-red-500' });
  }
  if (ratings.trakt && ratings.trakt.value > 0) {
    items.push({ label: 'Trakt', score: ratings.trakt.value.toFixed(1), votes: ratings.trakt.votes, color: 'text-purple-500 fill-purple-500' });
  }
  return items;
}

/** Sonarr publishes one aggregate score, on a 0–10 scale. */
export function seriesRatingItems(ratings: ArrRatingValue | undefined | null): RatingItem[] {
  if (!ratings || ratings.value <= 0) return [];
  return [{
    label: 'Sonarr',
    score: ratings.value.toFixed(1),
    votes: ratings.votes ?? 0,
    color: 'text-sky-500 fill-sky-500',
  }];
}

/** Compact vote counts: 1.2K, 45K, 3.1M. */
export function formatRatingVotes(votes: number): string {
  if (!votes) return '';
  if (votes >= 1_000_000) return `${(votes / 1_000_000).toFixed(1)}M`;
  if (votes >= 1_000) return `${(votes / 1_000).toFixed(votes >= 10_000 ? 0 : 1)}K`;
  return String(votes);
}
