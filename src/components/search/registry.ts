import { Tv, Film, Disc3, Bookmark, type LucideIcon } from 'lucide-react';
import type { Capability } from '@/lib/capabilities';
import { SEARCH_MODULE_CAPABILITY, type SearchModule } from '@/lib/search/types';

// Provider registry: one entry per searchable module (label + icon + the capability
// that gates it). Phase 2 remote modules (TMDB / AniList) become additive entries here,
// not edits to the palette core. Grouping order lives in SEARCH_MODULE_ORDER.
export interface SearchModuleDef {
  label: string;
  icon: LucideIcon;
  capability: Capability;
}

export const SEARCH_MODULE_DEF: Record<SearchModule, SearchModuleDef> = {
  series: { label: 'TV Series', icon: Tv, capability: SEARCH_MODULE_CAPABILITY.series },
  movies: { label: 'Movies', icon: Film, capability: SEARCH_MODULE_CAPABILITY.movies },
  music: { label: 'Music', icon: Disc3, capability: SEARCH_MODULE_CAPABILITY.music },
  watchlist: { label: 'Watchlist', icon: Bookmark, capability: SEARCH_MODULE_CAPABILITY.watchlist },
};
