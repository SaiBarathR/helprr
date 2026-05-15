/**
 * Configuration for the discover homepage layout.
 *
 * Sections can be "builtin" (the standard TMDB sections rendered by the API)
 * or "custom" (user-created carousels with saved filter sets).
 *
 * The layout is stored server-side in AppSettings.discoverLayout so it syncs
 * across all devices without per-device configuration.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoverLayoutCustomFilters {
  contentType: 'all' | 'movie' | 'show';
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  genres?: number[];
  yearFrom?: string;
  yearTo?: string;
  ratingMin?: string;
  ratingMax?: string;
  voteCountMin?: string;
  language?: string;
  region?: string;
  providers?: number[];
  networks?: number[];
  companies?: number[];
  releaseState?: string;
  runtimeMin?: string;
  runtimeMax?: string;
}

export interface DiscoverLayoutSection {
  /** Unique id — built-in sections use their API key, custom use 'custom_<ts>' */
  id: string;
  type: 'builtin' | 'custom';
  label: string;
  enabled: boolean;
  /** For custom sections only */
  filters?: DiscoverLayoutCustomFilters;
}

export interface DiscoverLayoutConfig {
  sections: DiscoverLayoutSection[];
}

// ---------------------------------------------------------------------------
// Built-in section definitions
// ---------------------------------------------------------------------------

export interface BuiltinSectionDef {
  id: string;
  label: string;
  /** Matches the section's `type` in the API response */
  sectionType: 'media' | 'genre' | 'provider';
  mediaType: 'all' | 'movie' | 'tv';
}

export const BUILTIN_DISCOVER_SECTIONS: BuiltinSectionDef[] = [
  { id: 'trending', label: 'Trending', sectionType: 'media', mediaType: 'all' },
  { id: 'trending_movies', label: 'Trending Movies', sectionType: 'media', mediaType: 'movie' },
  { id: 'trending_tv', label: 'Trending TV', sectionType: 'media', mediaType: 'tv' },
  { id: 'popular_all', label: 'Popular', sectionType: 'media', mediaType: 'all' },
  { id: 'now_playing', label: 'Now in Theaters', sectionType: 'media', mediaType: 'movie' },
  { id: 'popular_movies', label: 'Popular Movies', sectionType: 'media', mediaType: 'movie' },
  { id: 'movie_genres', label: 'Movie Genres', sectionType: 'genre', mediaType: 'movie' },
  { id: 'upcoming_movies', label: 'Upcoming Movies', sectionType: 'media', mediaType: 'movie' },
  { id: 'providers', label: 'Studios & Platforms', sectionType: 'provider', mediaType: 'all' },
  { id: 'airing_today', label: 'Airing Today', sectionType: 'media', mediaType: 'tv' },
  { id: 'popular_series', label: 'Popular Series', sectionType: 'media', mediaType: 'tv' },
  { id: 'series_genres', label: 'Series Genres', sectionType: 'genre', mediaType: 'tv' },
  { id: 'upcoming_series', label: 'Upcoming Series', sectionType: 'media', mediaType: 'tv' },
  { id: 'top_rated_movies', label: 'Top Rated Movies', sectionType: 'media', mediaType: 'movie' },
  { id: 'top_rated_tv', label: 'Top Rated TV', sectionType: 'media', mediaType: 'tv' },
];

const BUILTIN_IDS = new Set(BUILTIN_DISCOVER_SECTIONS.map((s) => s.id));

// ---------------------------------------------------------------------------
// Default layout
// ---------------------------------------------------------------------------

export const DEFAULT_DISCOVER_LAYOUT: DiscoverLayoutConfig = {
  sections: BUILTIN_DISCOVER_SECTIONS.map((s) => ({
    id: s.id,
    type: 'builtin' as const,
    label: s.label,
    enabled: true,
  })),
};

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Merge a persisted layout with the canonical built-in list.
 * - Adds any new built-in sections at the end (enabled by default).
 * - Removes built-in entries whose id is no longer recognised.
 * - Preserves custom sections and their order.
 */
export function reconcileDiscoverLayout(
  persisted: DiscoverLayoutConfig | null | undefined
): DiscoverLayoutConfig {
  if (!persisted?.sections?.length) {
    return { sections: DEFAULT_DISCOVER_LAYOUT.sections.map((s) => ({ ...s })) };
  }

  const seen = new Set<string>();
  const result: DiscoverLayoutSection[] = [];

  for (const entry of persisted.sections) {
    if (entry.type === 'builtin') {
      // Only keep if the id is still in the canonical list
      if (BUILTIN_IDS.has(entry.id)) {
        const def = BUILTIN_DISCOVER_SECTIONS.find((d) => d.id === entry.id)!;
        result.push({ ...entry, label: def.label }); // Keep label in sync
        seen.add(entry.id);
      }
    } else {
      // Custom sections are always kept
      result.push({ ...entry });
    }
  }

  // Append any new built-in sections that weren't in the persisted data
  for (const def of BUILTIN_DISCOVER_SECTIONS) {
    if (!seen.has(def.id)) {
      result.push({
        id: def.id,
        type: 'builtin',
        label: def.label,
        enabled: true,
      });
    }
  }

  return { sections: result };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function validateDiscoverLayout(raw: unknown): DiscoverLayoutConfig | null {
  if (!isObject(raw)) return null;
  const sections = (raw as Record<string, unknown>).sections;
  if (!Array.isArray(sections)) return null;

  const validated: DiscoverLayoutSection[] = [];
  const seenIds = new Set<string>();

  for (const entry of sections) {
    if (!isObject(entry)) continue;
    const id = (entry as Record<string, unknown>).id;
    const type = (entry as Record<string, unknown>).type;
    const label = (entry as Record<string, unknown>).label;
    const enabled = (entry as Record<string, unknown>).enabled;

    if (typeof id !== 'string' || !id) continue;
    if (type !== 'builtin' && type !== 'custom') continue;
    if (typeof label !== 'string' || !label) continue;
    if (typeof enabled !== 'boolean') continue;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const section: DiscoverLayoutSection = { id, type, label, enabled };

    if (type === 'custom') {
      const filters = (entry as Record<string, unknown>).filters;
      if (!isObject(filters)) continue;
      const f = filters as Record<string, unknown>;
      section.filters = {
        contentType: f.contentType === 'movie' || f.contentType === 'show'
          ? f.contentType : 'all',
        sortBy: typeof f.sortBy === 'string' ? f.sortBy : 'trending',
        sortOrder: f.sortOrder === 'asc' ? 'asc' : 'desc',
        genres: Array.isArray(f.genres) ? f.genres.filter((v): v is number => typeof v === 'number') : undefined,
        yearFrom: typeof f.yearFrom === 'string' ? f.yearFrom : undefined,
        yearTo: typeof f.yearTo === 'string' ? f.yearTo : undefined,
        ratingMin: typeof f.ratingMin === 'string' ? f.ratingMin : undefined,
        ratingMax: typeof f.ratingMax === 'string' ? f.ratingMax : undefined,
        voteCountMin: typeof f.voteCountMin === 'string' ? f.voteCountMin : undefined,
        language: typeof f.language === 'string' ? f.language : undefined,
        region: typeof f.region === 'string' ? f.region : undefined,
        providers: Array.isArray(f.providers) ? f.providers.filter((v): v is number => typeof v === 'number') : undefined,
        networks: Array.isArray(f.networks) ? f.networks.filter((v): v is number => typeof v === 'number') : undefined,
        companies: Array.isArray(f.companies) ? f.companies.filter((v): v is number => typeof v === 'number') : undefined,
        releaseState: typeof f.releaseState === 'string' ? f.releaseState : undefined,
        runtimeMin: typeof f.runtimeMin === 'string' ? f.runtimeMin : undefined,
        runtimeMax: typeof f.runtimeMax === 'string' ? f.runtimeMax : undefined,
      };
    }

    validated.push(section);
  }

  if (validated.length === 0) return null;
  return { sections: validated };
}

/**
 * Build the default custom filters object for creating a new custom carousel.
 */
export function buildDefaultCustomFilters(): DiscoverLayoutCustomFilters {
  return {
    contentType: 'all',
    sortBy: 'trending',
    sortOrder: 'desc',
  };
}
