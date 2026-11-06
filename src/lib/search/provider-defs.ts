import { TMDB_TITLE_PAGE_CAPABILITIES, type Capability } from '@/lib/capabilities';
import type { SearchProviderCost, SearchProviderId } from '@/lib/search/types';

// Client-safe provider metadata (no icons — those live in components/search/registry.ts).
// Shared between the palette parser and the server route for consistent gating/debounce.

export interface SearchProviderDef {
  id: SearchProviderId;
  /** Primary modifier typed before space (e.g. `tm`). */
  alias: string;
  label: string;
  description: string;
  capability: Capability;
  minQuery: number;
  debounceMs: number;
  cost: SearchProviderCost;
  /** When true, provider needs a TMDB ServiceConnection. */
  requiresTmdb?: boolean;
  /** When true, provider needs a Seerr ServiceConnection. */
  requiresSeerr?: boolean;
  /**
   * When true, a member without `capability` may still use the provider if they
   * can request (with Seerr connected) and open the TMDB title pages its
   * results link to. See canUseSearchProvider.
   */
  openToRequesters?: boolean;
}

export const SEARCH_PROVIDER_DEFS: SearchProviderDef[] = [
  {
    id: 'series',
    alias: 'ser',
    label: 'TV Series',
    description: 'Search your Sonarr library',
    capability: 'series.view',
    minQuery: 2,
    debounceMs: 280,
    cost: 'local',
  },
  {
    id: 'movies',
    alias: 'mov',
    label: 'Movies',
    description: 'Search your Radarr library',
    capability: 'movies.view',
    minQuery: 2,
    debounceMs: 280,
    cost: 'local',
  },
  {
    id: 'music',
    alias: 'mus',
    label: 'Music',
    description: 'Search your Lidarr library',
    capability: 'music.view',
    minQuery: 2,
    debounceMs: 280,
    cost: 'local',
  },
  {
    id: 'watchlist',
    alias: 'wl',
    label: 'Watchlist',
    description: 'Search your watchlist',
    capability: 'watchlist.view',
    minQuery: 2,
    debounceMs: 280,
    cost: 'local',
  },
  {
    id: 'tmdb',
    alias: 'tm',
    label: 'TMDB',
    description: 'Discover movies and TV to add',
    capability: 'discover.view',
    minQuery: 2,
    debounceMs: 500,
    cost: 'remote',
    requiresTmdb: true,
    openToRequesters: true,
  },
  {
    id: 'anilist',
    alias: 'ani',
    label: 'AniList',
    description: 'Search anime metadata',
    capability: 'anime.view',
    minQuery: 2,
    debounceMs: 500,
    cost: 'remote',
  },
  {
    id: 'requests',
    alias: 'req',
    label: 'Requests',
    description: 'Search Seerr requests',
    capability: 'requests.view',
    minQuery: 2,
    debounceMs: 400,
    cost: 'service',
    requiresSeerr: true,
  },
  {
    id: 'torrents',
    alias: 'tor',
    label: 'Torrents',
    description: 'Search active torrents',
    capability: 'torrents.view',
    minQuery: 2,
    debounceMs: 350,
    cost: 'service',
  },
  {
    id: 'activity',
    alias: 'act',
    label: 'Activity',
    description: 'Search recent imports and history',
    capability: 'activity.view',
    minQuery: 2,
    debounceMs: 350,
    cost: 'service',
  },
  {
    id: 'notifications',
    alias: 'ntf',
    label: 'Notifications',
    description: 'Search notification history',
    capability: 'notifications.view',
    minQuery: 2,
    debounceMs: 280,
    cost: 'local',
  },
  {
    id: 'prowlarr',
    alias: 'pro',
    label: 'Prowlarr',
    description: 'Search indexer history and indexers',
    capability: 'prowlarr.view',
    minQuery: 2,
    debounceMs: 350,
    cost: 'service',
  },
];

export const SEARCH_PROVIDER_ORDER: SearchProviderId[] = SEARCH_PROVIDER_DEFS.map((d) => d.id);

export const SEARCH_PROVIDER_BY_ID: Record<SearchProviderId, SearchProviderDef> = Object.fromEntries(
  SEARCH_PROVIDER_DEFS.map((d) => [d.id, d])
) as Record<SearchProviderId, SearchProviderDef>;

/** Alias (and id) → provider definition. Case-insensitive lookup via normalizeAlias(). */
export const SEARCH_ALIAS_TO_PROVIDER: Record<string, SearchProviderId> = Object.fromEntries(
  SEARCH_PROVIDER_DEFS.flatMap((d) => [
    [d.alias, d.id],
    [d.id, d.id],
  ])
);

export function normalizeSearchAlias(raw: string): string {
  return raw.trim().toLowerCase();
}

export function resolveProviderFromAlias(alias: string): SearchProviderDef | undefined {
  const id = SEARCH_ALIAS_TO_PROVIDER[normalizeSearchAlias(alias)];
  return id ? SEARCH_PROVIDER_BY_ID[id] : undefined;
}

/**
 * Whether a user may use a provider. Shared by the palette and the server
 * route so the two never disagree. A member who can request but not browse
 * Discover still needs a way to find a title to request: TMDB search leads to
 * the title pages, which carry the Request button.
 */
export function canUseSearchProvider(
  def: SearchProviderDef,
  has: (cap: Capability) => boolean,
  seerrConfigured: boolean
): boolean {
  if (has(def.capability)) return true;
  return def.openToRequesters === true
    && seerrConfigured
    && has('requests.create')
    && TMDB_TITLE_PAGE_CAPABILITIES.some(has);
}
