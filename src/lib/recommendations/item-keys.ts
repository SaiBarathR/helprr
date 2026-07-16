// Canonical cross-source item identity for the recommendation pipeline.
//
// Every surface (rails, feed, events, exclusion sets) addresses a title by ONE
// string key so a movie recommended from TMDB, owned in Radarr, and disliked
// from the feed all resolve to the same history:
//   tmdb:movie:<id> | tmdb:tv:<id>              — TMDB-identified titles
//   anilist:<mediaId>                            — anime
//   arr:radarr:<instanceId>:<id> / arr:sonarr:…  — owned titles with no TMDB id
//   jf:<jellyfinItemId>                          — Jellyfin-only (resume) items
//
// TMDB keys are namespaced by media kind because TMDB's movie and TV id spaces
// overlap (same rationale as providerKey in types/watch-status.ts).
// Import-safe from client and server (pure strings only).

export type RecMediaType = 'movie' | 'tv' | 'anime';

export function tmdbItemKey(mediaType: 'movie' | 'tv', tmdbId: number): string {
  return `tmdb:${mediaType}:${tmdbId}`;
}

export function anilistItemKey(mediaId: number): string {
  return `anilist:${mediaId}`;
}

export function arrItemKey(scope: 'radarr' | 'sonarr', instanceId: string, id: number): string {
  return `arr:${scope}:${instanceId}:${id}`;
}

export function jellyfinItemKey(jellyfinItemId: string): string {
  return `jf:${jellyfinItemId}`;
}

export interface ParsedItemKey {
  /** null for jf:* keys (media kind unknown from the key alone). */
  mediaType: RecMediaType | null;
  /** Set for tmdb:* keys. */
  tmdbId?: number;
  /** Set for anilist:* keys. */
  anilistId?: number;
}

const TMDB_KEY_RE = /^tmdb:(movie|tv):(\d{1,10})$/;
const ANILIST_KEY_RE = /^anilist:(\d{1,10})$/;
const ARR_KEY_RE = /^arr:(radarr|sonarr):[A-Za-z0-9_-]{1,40}:\d{1,10}$/;
const JELLYFIN_KEY_RE = /^jf:[A-Za-z0-9-]{1,40}$/;

/** Parse a canonical item key; null for anything malformed (events API rejects those). */
export function parseItemKey(key: string): ParsedItemKey | null {
  const tmdb = TMDB_KEY_RE.exec(key);
  if (tmdb) {
    return { mediaType: tmdb[1] as 'movie' | 'tv', tmdbId: Number(tmdb[2]) };
  }
  const anilist = ANILIST_KEY_RE.exec(key);
  if (anilist) {
    return { mediaType: 'anime', anilistId: Number(anilist[1]) };
  }
  const arr = ARR_KEY_RE.exec(key);
  if (arr) {
    return { mediaType: arr[1] === 'radarr' ? 'movie' : 'tv' };
  }
  if (JELLYFIN_KEY_RE.test(key)) {
    return { mediaType: null };
  }
  return null;
}

export function isItemKey(key: string): boolean {
  return parseItemKey(key) !== null;
}
