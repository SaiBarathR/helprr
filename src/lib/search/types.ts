import type { Capability } from '@/lib/capabilities';
import type { ImageServiceHint } from '@/lib/image';

// ─────────────────────────────────────────────────────────────────────────────
// Global search — shared types. Import-safe from both client and server: it only
// `import type`s, so bundling it into the palette never drags Prisma/Redis in.
// ─────────────────────────────────────────────────────────────────────────────

export type SearchModule = 'series' | 'movies' | 'music' | 'watchlist';

/** Phase 2 scoped search providers (modifier targets). */
export type SearchProviderId =
  | 'tmdb'
  | 'anilist'
  | 'requests'
  | 'torrents'
  | 'prowlarr'
  | 'activity'
  | 'notifications'
  | 'series'
  | 'movies'
  | 'music'
  | 'watchlist';

export type SearchProviderCost = 'local' | 'service' | 'remote';

/** A normalized, scoreable record for one library item in one module/instance. */
export interface SearchDoc {
  /** Stable per (module, instance, item): `${module}:${instanceId}:${itemId}`. */
  id: string;
  module: SearchModule;
  title: string;
  /** normalizeTitle(title) — precomputed so scoring never re-normalizes per keystroke. */
  sortTitle: string;
  year: number | null;
  /** Every stable id we have, for cross-module dedup (mbid scopes music artists). */
  ids: { tmdb?: number; tvdb?: number; imdb?: string; anilist?: number; mbid?: string };
  subtitle?: string;
  /** Raw poster URL (remoteUrl/url); the client runs it through toCachedImageSrc. */
  poster?: string | null;
  posterService?: ImageServiceHint;
  /** Deep link, instance-aware where relevant (e.g. `/movies/12?instance=abc`). */
  route: string;
}

/** One module's contribution to a deduped result (its own deep link). */
export interface SearchResultRef {
  module: SearchModule;
  route: string;
}

/** A deduped, ranked result: one underlying title carrying every module it lives in. */
export interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  year: number | null;
  poster: string | null;
  posterService?: ImageServiceHint;
  /** Sorted by SEARCH_MODULE_ORDER; modules[0] is the primary (group + default route). */
  modules: SearchResultRef[];
  score: number;
}

export interface SearchResponse {
  results: SearchResult[];
  searched: SearchModule[];
  degraded: SearchModule[];
}

/** One row from a scoped provider search (Phase 2). */
export interface SearchProviderResult {
  id: string;
  title: string;
  subtitle?: string;
  year: number | null;
  poster: string | null;
  posterService?: ImageServiceHint;
  route: string;
  provider: SearchProviderId;
  badge?: string;
  score?: number;
}

export interface SearchProviderRateLimit {
  retryAfterSeconds: number;
  retryAt: string | null;
}

export interface SearchProviderResponse {
  results: SearchProviderResult[];
  searched: SearchProviderId[];
  degraded: SearchProviderId[];
  rateLimited?: SearchProviderRateLimit;
  meta?: {
    scopeLabel: string;
    cost: SearchProviderCost;
    remote?: boolean;
  };
}

/** Module → the `*.view` capability that gates it. No dedicated `search.view` cap:
 * a user searches exactly the modules they can already see. */
export const SEARCH_MODULE_CAPABILITY: Record<SearchModule, Capability> = {
  series: 'series.view',
  movies: 'movies.view',
  music: 'music.view',
  watchlist: 'watchlist.view',
};

/** Priority order: drives result grouping and which module owns the primary route. */
export const SEARCH_MODULE_ORDER: SearchModule[] = ['series', 'movies', 'music', 'watchlist'];

/** Maps local library modules to their provider id (scoped modifier target). */
export const SEARCH_MODULE_TO_PROVIDER: Record<SearchModule, SearchProviderId> = {
  series: 'series',
  movies: 'movies',
  music: 'music',
  watchlist: 'watchlist',
};

export function isSearchModuleProvider(id: SearchProviderId): id is SearchModule {
  return (SEARCH_MODULE_ORDER as string[]).includes(id);
}
