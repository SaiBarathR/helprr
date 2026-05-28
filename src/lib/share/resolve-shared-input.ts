import { getTMDBClient } from '@/lib/service-helpers';

export interface ResolvedTmdbHit {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
}

export type ResolvedShare =
  | { kind: 'tmdb'; hit: ResolvedTmdbHit }
  | { kind: 'multi'; hits: ResolvedTmdbHit[]; query: string }
  | { kind: 'query'; query: string }
  | { kind: 'unknown' };

export interface SharedInput {
  title?: string | null;
  text?: string | null;
  url?: string | null;
}

const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w500';

function makeHit(
  raw: {
    id?: number;
    title?: string;
    name?: string;
    release_date?: string;
    first_air_date?: string;
    overview?: string;
    poster_path?: string | null;
  },
  mediaType: 'movie' | 'tv',
): ResolvedTmdbHit | null {
  if (!raw.id) return null;
  const title = mediaType === 'movie' ? raw.title : raw.name;
  if (!title) return null;
  const dateStr = mediaType === 'movie' ? raw.release_date : raw.first_air_date;
  const yearNum = dateStr ? Number(dateStr.slice(0, 4)) : NaN;
  return {
    tmdbId: raw.id,
    mediaType,
    title,
    year: Number.isFinite(yearNum) ? yearNum : null,
    overview: raw.overview ?? '',
    posterPath: raw.poster_path ? `${TMDB_POSTER_BASE}${raw.poster_path}` : null,
  };
}

const TMDB_URL_RE = /themoviedb\.org\/(movie|tv)\/(\d+)/i;
const IMDB_URL_RE = /imdb\.com\/title\/(tt\d+)/i;
const TVDB_URL_RE = /thetvdb\.com\/.*?(?:id=|series\/)(\d+)/i;

/**
 * Try to resolve whatever the user shared (URL, title text, or both) into a
 * concrete TMDB hit. Falls through to `query` (best-effort multi-search) when
 * the input is just a title, and to `unknown` only when there's nothing to
 * work with.
 *
 * Order matters: a TMDB URL is unambiguous, so try it first. IMDb URL requires
 * a TMDB `/find` lookup; TVDB URL likewise. Plain text falls back to a
 * multi-search whose top results are returned for disambiguation.
 */
export async function resolveSharedInput(input: SharedInput): Promise<ResolvedShare> {
  const haystack = [input.url, input.text].filter(Boolean).join(' ');

  // Exact TMDB URL — done immediately.
  const tmdbMatch = haystack.match(TMDB_URL_RE);
  if (tmdbMatch) {
    const mediaType = tmdbMatch[1].toLowerCase() as 'movie' | 'tv';
    const tmdbId = Number.parseInt(tmdbMatch[2], 10);
    if (Number.isInteger(tmdbId) && tmdbId > 0) {
      try {
        const tmdb = await getTMDBClient();
        const detail = mediaType === 'movie'
          ? await tmdb.movieDetails(tmdbId)
          : await tmdb.tvDetails(tmdbId);
        const hit = makeHit(detail, mediaType);
        if (hit) return { kind: 'tmdb', hit };
      } catch {
        // Fall through to text search
      }
    }
  }

  // IMDb URL — needs TMDB /find lookup.
  const imdbMatch = haystack.match(IMDB_URL_RE);
  if (imdbMatch) {
    try {
      const tmdb = await getTMDBClient();
      const found = await tmdb.findByExternalId(imdbMatch[1], 'imdb_id');
      if (found.movie_results.length > 0) {
        const hit = makeHit(found.movie_results[0], 'movie');
        if (hit) return { kind: 'tmdb', hit };
      }
      if (found.tv_results.length > 0) {
        const hit = makeHit(found.tv_results[0], 'tv');
        if (hit) return { kind: 'tmdb', hit };
      }
    } catch {
      // Fall through
    }
  }

  // TVDB URL — needs TMDB /find lookup, TV only.
  const tvdbMatch = haystack.match(TVDB_URL_RE);
  if (tvdbMatch) {
    try {
      const tmdb = await getTMDBClient();
      const found = await tmdb.findByExternalId(tvdbMatch[1], 'tvdb_id');
      if (found.tv_results.length > 0) {
        const hit = makeHit(found.tv_results[0], 'tv');
        if (hit) return { kind: 'tmdb', hit };
      }
    } catch {
      // Fall through
    }
  }

  // Plain text: multi-search and surface up to 5 hits for disambiguation.
  const query = (input.title || input.text || '').trim();
  if (query.length === 0) return { kind: 'unknown' };

  try {
    const tmdb = await getTMDBClient();
    const data = await tmdb.searchMulti(query);
    const hits: ResolvedTmdbHit[] = [];
    for (const result of data.results || []) {
      if (result.media_type === 'movie') {
        const hit = makeHit(result, 'movie');
        if (hit) hits.push(hit);
      } else if (result.media_type === 'tv') {
        const hit = makeHit(result, 'tv');
        if (hit) hits.push(hit);
      }
      if (hits.length >= 5) break;
    }
    if (hits.length === 1) return { kind: 'tmdb', hit: hits[0] };
    if (hits.length > 1) return { kind: 'multi', hits, query };
  } catch {
    // Fall through
  }

  return { kind: 'query', query };
}
