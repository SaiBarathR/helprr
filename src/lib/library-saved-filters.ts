import type { MediaWatchFilterPreference } from '@/lib/store';
import { EMPTY_LIBRARY_FACETS, LIBRARY_FACET_KEYS, type LibraryFacetFilters } from '@/lib/library-filtering';

/** What a library page's filter menu narrows it by. The search box stays out: it is typed per visit. */
export interface LibraryFilterState {
  status: string[];
  facets: LibraryFacetFilters;
  /** 'all' or one instance's id. */
  instance: string;
  /** Music has no watch status and always keeps 'all'. */
  watch: MediaWatchFilterPreference;
}

/**
 * A named filter set the user saved on this device. Helprr keeps its own instead
 * of Sonarr/Radarr's custom filters (/api/v3/customfilter), which hold one
 * instance's fields and would be written for every user of that instance.
 */
export interface SavedLibraryFilter extends LibraryFilterState {
  id: string;
  name: string;
}

export const SAVED_FILTER_NAME_MAX = 60;

const WATCH_CHOICES: readonly MediaWatchFilterPreference[] = ['all', 'watched', 'unwatched'];

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))] : [];
}

/** A stored or imported facet set made safe to read, or null when it isn't one. */
export function sanitizeLibraryFacets(value: unknown): LibraryFacetFilters | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  return {
    tags: strings(obj.tags),
    qualityProfiles: strings(obj.qualityProfiles),
    rootFolders: strings(obj.rootFolders),
    genres: strings(obj.genres),
  };
}

/**
 * A stored or imported saved-filter list made safe to read, or null when it isn't
 * a list. Entries without an id or a name, and repeated ids, are dropped; unknown
 * status filters are dropped as the page's own filter list drops them.
 */
export function sanitizeSavedLibraryFilters(value: unknown, statusChoices: readonly string[]): SavedLibraryFilter[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const out: SavedLibraryFilter[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id : '';
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, SAVED_FILTER_NAME_MAX) : '';
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      status: strings(raw.status).filter((status) => statusChoices.includes(status)),
      facets: sanitizeLibraryFacets(raw.facets) ?? { ...EMPTY_LIBRARY_FACETS },
      instance: typeof raw.instance === 'string' && raw.instance ? raw.instance : 'all',
      watch: WATCH_CHOICES.includes(raw.watch as MediaWatchFilterPreference) ? raw.watch as MediaWatchFilterPreference : 'all',
    });
  }
  return out;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/** The same filters, whatever order they were picked in. */
export function sameLibraryFilterState(a: LibraryFilterState, b: LibraryFilterState): boolean {
  return sameSet(a.status, b.status)
    && LIBRARY_FACET_KEYS.every((key) => sameSet(a.facets[key], b.facets[key]))
    && a.instance === b.instance
    && a.watch === b.watch;
}

export function hasLibraryFilterState(state: LibraryFilterState): boolean {
  return state.status.length > 0
    || LIBRARY_FACET_KEYS.some((key) => state.facets[key].length > 0)
    || state.instance !== 'all'
    || state.watch !== 'all';
}

/** Saved filter names compare without case: "4K" and "4k" are one filter. */
export function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}

function newId(): string {
  // Not crypto.randomUUID: it is missing on plain-http LAN origins, where Helprr often runs.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function copyState(state: LibraryFilterState): LibraryFilterState {
  return {
    status: [...state.status],
    facets: {
      tags: [...state.facets.tags],
      qualityProfiles: [...state.facets.qualityProfiles],
      rootFolders: [...state.facets.rootFolders],
      genres: [...state.facets.genres],
    },
    instance: state.instance,
    watch: state.watch,
  };
}

/**
 * Save the current filters under a name. A saved filter of the same name (case
 * aside) takes the new filters in its place, so saving again updates it.
 */
export function saveLibraryFilter(
  list: readonly SavedLibraryFilter[],
  name: string,
  state: LibraryFilterState,
  makeId: () => string = newId,
): { list: SavedLibraryFilter[]; replaced: boolean } {
  const trimmed = name.trim().slice(0, SAVED_FILTER_NAME_MAX);
  const existing = list.find((saved) => sameName(saved.name, trimmed));
  if (existing) {
    return {
      list: list.map((saved) => (saved === existing ? { ...copyState(state), id: saved.id, name: trimmed } : saved)),
      replaced: true,
    };
  }
  return { list: [...list, { ...copyState(state), id: makeId(), name: trimmed }], replaced: false };
}

/** Rename one saved filter; null when another one already has that name. */
export function renameSavedLibraryFilter(
  list: readonly SavedLibraryFilter[],
  id: string,
  name: string,
): SavedLibraryFilter[] | null {
  const trimmed = name.trim().slice(0, SAVED_FILTER_NAME_MAX);
  if (!trimmed) return null;
  if (list.some((saved) => saved.id !== id && sameName(saved.name, trimmed))) return null;
  return list.map((saved) => (saved.id === id ? { ...saved, name: trimmed } : saved));
}
