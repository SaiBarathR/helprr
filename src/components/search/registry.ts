import {
  Tv,
  Film,
  Disc3,
  Bookmark,
  Compass,
  Sparkles,
  Inbox,
  HardDrive,
  Activity,
  Bell,
  Search,
  type LucideIcon,
} from 'lucide-react';
import type { Capability } from '@/lib/capabilities';
import {
  SEARCH_MODULE_CAPABILITY,
  SEARCH_MODULE_ORDER,
  type SearchModule,
  type SearchProviderId,
} from '@/lib/search/types';
import {
  SEARCH_PROVIDER_BY_ID,
  SEARCH_PROVIDER_DEFS,
  SEARCH_PROVIDER_ORDER,
  type SearchProviderDef,
} from '@/lib/search/provider-defs';

// Client registry: label + icon + capability for each searchable module/provider.
// Phase 1 local modules and Phase 2 scoped providers share one lookup table.

export interface SearchModuleDef {
  label: string;
  icon: LucideIcon;
  capability: Capability;
}

const PROVIDER_ICONS: Record<SearchProviderId, LucideIcon> = {
  series: Tv,
  movies: Film,
  music: Disc3,
  watchlist: Bookmark,
  tmdb: Compass,
  anilist: Sparkles,
  requests: Inbox,
  torrents: HardDrive,
  activity: Activity,
  notifications: Bell,
  prowlarr: Search,
};

export interface SearchProviderUiDef extends SearchProviderDef {
  icon: LucideIcon;
}

export const SEARCH_PROVIDER_UI: Record<SearchProviderId, SearchProviderUiDef> = Object.fromEntries(
  SEARCH_PROVIDER_DEFS.map((def) => [def.id, { ...def, icon: PROVIDER_ICONS[def.id] }])
) as Record<SearchProviderId, SearchProviderUiDef>;

export const SEARCH_MODULE_DEF: Record<SearchModule, SearchModuleDef> = {
  series: {
    label: SEARCH_PROVIDER_UI.series.label,
    icon: SEARCH_PROVIDER_UI.series.icon,
    capability: SEARCH_MODULE_CAPABILITY.series,
  },
  movies: {
    label: SEARCH_PROVIDER_UI.movies.label,
    icon: SEARCH_PROVIDER_UI.movies.icon,
    capability: SEARCH_MODULE_CAPABILITY.movies,
  },
  music: {
    label: SEARCH_PROVIDER_UI.music.label,
    icon: SEARCH_PROVIDER_UI.music.icon,
    capability: SEARCH_MODULE_CAPABILITY.music,
  },
  watchlist: {
    label: SEARCH_PROVIDER_UI.watchlist.label,
    icon: SEARCH_PROVIDER_UI.watchlist.icon,
    capability: SEARCH_MODULE_CAPABILITY.watchlist,
  },
};

export { SEARCH_MODULE_ORDER, SEARCH_PROVIDER_ORDER, SEARCH_PROVIDER_BY_ID };
