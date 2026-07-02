import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type NavItemId, DEFAULT_NAV_ORDER, NAV_ITEM_MAP, reconcileNavOrder,
} from '@/lib/nav-config';
import {
  type AnimeCarouselId,
  DEFAULT_ANIME_CAROUSEL_ORDER,
} from '@/lib/anime-carousel-config';
import type { DiscoverContentType } from '@/types';
import {
  reconcileDiscoverLayout,
  type DiscoverLayoutConfig,
} from '@/lib/discover-layout-config';
import {
  DEFAULT_DASHBOARD_THEME,
  DEFAULT_GLASS_INTENSITY,
  DEFAULT_GLASS_MODE,
  DEFAULT_LIQUID_GLASS,
  UI_PREFS_STORAGE_KEY,
  type DashboardAccent,
  type DashboardFont,
  type DashboardGradient,
  type DashboardPalette,
  type GlassMode,
} from '@/lib/dashboard-theme';

export type MediaViewMode = 'posters' | 'overview' | 'table';
export type PosterSize = 'small' | 'medium' | 'large';
export type VisibleFieldsByMode = Record<MediaViewMode, string[]>;

export interface DiscoverFiltersState {
  genres: number[];
  yearFrom: string;
  yearTo: string;
  runtimeMin: string;
  runtimeMax: string;
  language: string;
  region: string;
  ratingMin: string;
  ratingMax: string;
  voteCountMin: string;
  providers: number[];
  networks: number[];
  companies: number[];
  releaseState: '' | 'released' | 'upcoming' | 'airing' | 'ended';
}

const DEFAULT_MOVIES_FIELDS: VisibleFieldsByMode = {
  posters: ['title', 'year', 'rating', 'monitored', 'watchStatus'],
  overview: ['title', 'qualityProfile', 'rating', 'studio', 'certification', 'sizeOnDisk', 'runtime', 'monitored', 'year', 'watchStatus', 'genres', 'overview', 'images'],
  table: ['monitored', 'title', 'year', 'qualityProfile', 'studio', 'rating', 'watchStatus', 'sizeOnDisk'],
};

const DEFAULT_SERIES_FIELDS: VisibleFieldsByMode = {
  posters: ['title', 'year', 'rating', 'monitored', 'watchStatus'],
  overview: ['title', 'qualityProfile', 'rating', 'network', 'sizeOnDisk', 'runtime', 'monitored', 'year', 'episodeProgress', 'watchStatus', 'genres', 'overview', 'images'],
  table: ['monitored', 'title', 'year', 'qualityProfile', 'network', 'episodeProgress', 'rating', 'watchStatus', 'sizeOnDisk'],
};

const DEFAULT_MUSIC_FIELDS: VisibleFieldsByMode = {
  posters: ['rating', 'monitored'],
  overview: ['qualityProfile', 'metadataProfile', 'rating', 'artistType', 'albumCount', 'trackProgress', 'sizeOnDisk', 'monitored', 'genres', 'overview', 'images'],
  table: ['monitored', 'artistType', 'qualityProfile', 'albumCount', 'trackProgress', 'rating', 'sizeOnDisk'],
};

export const DEFAULT_DISCOVER_FILTERS: DiscoverFiltersState = {
  genres: [],
  yearFrom: '',
  yearTo: '',
  runtimeMin: '',
  runtimeMax: '',
  language: '',
  region: 'US',
  ratingMin: '',
  ratingMax: '',
  voteCountMin: '',
  providers: [],
  networks: [],
  companies: [],
  releaseState: '',
};

export interface AnimeFiltersState {
  genres: string[];
  year: string;
  yearMin: string;
  yearMax: string;
  season: string;
  formats: string[];
  status: string;
}

export type TorrentsFilterPreference =
  | 'all'
  | 'downloading'
  | 'seeding'
  | 'completed'
  | 'paused'
  | 'active';
export type TorrentsSortKeyPreference =
  | 'name'
  | 'size'
  | 'progress'
  | 'dlspeed'
  | 'upspeed'
  | 'eta'
  | 'ratio'
  | 'added_on'
  | 'completion_on'
  | 'num_seeds'
  | 'num_leechs'
  | 'priority'
  | 'category'
  | 'state'
  | 'uploaded'
  | 'downloaded'
  | 'amount_left'
  | 'time_active'
  | 'seeding_time';
export type TorrentsSortDirectionPreference = 'asc' | 'desc';
export type ActivityTabPreference = 'queue' | 'failed' | 'missing' | 'cutoff';
export type ActivitySortPreference = 'title' | 'progress' | 'timeleft' | 'size';
export type NotificationsReadStatePreference = 'all' | 'unread' | 'read';

export type RequestsTabPreference = 'requests' | 'users';
export type RequestsFilterPreference =
  | 'all'
  | 'pending'
  | 'approved'
  | 'processing'
  | 'available'
  | 'unavailable'
  | 'failed';

/** Empty = all types. Values match Seerr request `type` field. */
export type RequestsTypeFilterPreference = ('movie' | 'tv')[];
export type RequestsSortPreference = 'added' | 'modified';
export type RequestsSortDirectionPreference = 'asc' | 'desc';

/** Jellyfin watch filter for movies/series list pages. */
export type MediaWatchFilterPreference = 'all' | 'watched' | 'unwatched';

const WATCH_FILTER_PERSISTED_KEYS: ReadonlySet<string> = new Set([
  'moviesWatchFilter',
  'seriesWatchFilter',
]);

function isMediaWatchFilterPreference(value: unknown): value is MediaWatchFilterPreference {
  return value === 'all' || value === 'watched' || value === 'unwatched';
}

export interface NotificationsFiltersState {
  search: string;
  eventTypes: string[];
  readState: NotificationsReadStatePreference;
  dateFrom: string | null;
  dateTo: string | null;
}

export const DEFAULT_NOTIFICATIONS_FILTERS: NotificationsFiltersState = {
  search: '',
  eventTypes: [],
  readState: 'all',
  dateFrom: null,
  dateTo: null,
};

function cloneNotificationsFilters(filters: NotificationsFiltersState): NotificationsFiltersState {
  return { ...filters, eventTypes: [...filters.eventTypes] };
}

export type CleanupReSearchedFilter = 'yes' | 'no' | null;

export interface CleanupHistoryFiltersState {
  cleaner: string[];
  strikeType: string[];
  ruleId: string[];
  action?: string[];
  reSearched?: CleanupReSearchedFilter;
  dateFrom: string | null;
  dateTo: string | null;
}

export const DEFAULT_CLEANUP_HISTORY_FILTERS: CleanupHistoryFiltersState = {
  cleaner: [],
  strikeType: [],
  ruleId: [],
  action: [],
  reSearched: null,
  dateFrom: null,
  dateTo: null,
};

function cloneCleanupHistoryFilters(f: CleanupHistoryFiltersState): CleanupHistoryFiltersState {
  return {
    cleaner: [...f.cleaner],
    strikeType: [...f.strikeType],
    ruleId: [...f.ruleId],
    action: [...(f.action ?? [])],
    reSearched: f.reSearched ?? null,
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
  };
}

export const DEFAULT_ANIME_FILTERS: AnimeFiltersState = {
  genres: [],
  year: '',
  yearMin: '',
  yearMax: '',
  season: '',
  formats: [],
  status: '',
};

function cloneAnimeFilters(filters: AnimeFiltersState): AnimeFiltersState {
  return {
    ...filters,
    genres: [...filters.genres],
    formats: [...filters.formats],
  };
}

function cloneDiscoverFilters(filters: DiscoverFiltersState): DiscoverFiltersState {
  return {
    ...filters,
    genres: [...(filters.genres ?? [])],
    providers: [...(filters.providers ?? [])],
    networks: [...(filters.networks ?? [])],
    companies: [...(filters.companies ?? [])],
  };
}

export const STORE_VERSION = 38;

export function migrateUiPrefs(persisted: unknown, version: number): Record<string, unknown> {
  const state = (persisted && typeof persisted === 'object' ? persisted : {}) as Record<string, unknown>;
  if (version === 0) {
    const oldMovies = state.moviesVisibleFields;
    if (Array.isArray(oldMovies)) {
      state.moviesVisibleFields = {
        posters: DEFAULT_MOVIES_FIELDS.posters,
        overview: oldMovies,
        table: DEFAULT_MOVIES_FIELDS.table,
      };
    }
    const oldSeries = state.seriesVisibleFields;
    if (Array.isArray(oldSeries)) {
      state.seriesVisibleFields = {
        posters: DEFAULT_SERIES_FIELDS.posters,
        overview: oldSeries,
        table: DEFAULT_SERIES_FIELDS.table,
      };
    }
  }
  if (version < 2) {
    state.navOrder = [...DEFAULT_NAV_ORDER];
    state.disabledNavItems = [];
  }
  if (version < 3) {
    state.defaultPage = 'dashboard';
  }
  if (version < 4) {
    state.discoverContentType = 'all';
    state.discoverSort = 'trending';
    state.discoverSortDirection = 'desc';
    state.discoverFilters = cloneDiscoverFilters(DEFAULT_DISCOVER_FILTERS);
  }
  if (version < 5) {
    state.moviesSearch = '';
    state.seriesSearch = '';
  }
  if (version < 6) {
    // dashboardLayout previously seeded here; now lives in the DashboardLayout DB table.
  }
  if (version < 8) {
    state.animeSort = 'trending';
    state.animeFilters = cloneAnimeFilters(DEFAULT_ANIME_FILTERS);
    if (state.discoverContentType === 'anime') {
      state.discoverContentType = 'all';
    }
  }
  if (version < 9) {
    state.animeSort = 'seasonal';
  }
  if (version < 10) {
    state.navPosition = 'top';
  }
  if (version < 11) {
    // dashboardLayout previously rewritten here; now lives server-side.
  }
  if (version < 12) {
    const filters = state.discoverFilters as Record<string, unknown> | undefined;
    if (filters && !Array.isArray(filters.companies)) {
      filters.companies = [];
    }
  }
  if (version < 13) {
    state.torrentsFilter = 'all';
    state.torrentsSortKey = 'added_on';
    state.torrentsSortDir = 'desc';
    state.activityTab = 'queue';
    state.activitySortBy = 'progress';
    state.activityFilterBy = 'all';
  }
  if (version < 14) {
    state.notificationsFilters = cloneNotificationsFilters(DEFAULT_NOTIFICATIONS_FILTERS);
  }
  if (version < 15) {
    state.animeCarouselOrder = [...DEFAULT_ANIME_CAROUSEL_ORDER];
    state.disabledAnimeCarousels = [];
  }
  if (version < 16) {
    state.moviesFilter = [];
    state.seriesFilter = [];
    state.torrentsFilter = [];
  }
  if (version < 17) {
    state.cleanupHistoryFilters = cloneCleanupHistoryFilters(DEFAULT_CLEANUP_HISTORY_FILTERS);
  }
  if (version < 18) {
    const existing = state.cleanupHistoryFilters as Record<string, unknown> | undefined;
    if (existing && typeof existing === 'object' && !('reSearched' in existing)) {
      existing.reSearched = null;
    }
  }
  if (version < 19) {
    // Discover Layout config now drives previously-dynamic widgets. Clear the
    // cached config and re-sanitize: any persisted `discover-*` widget instances
    // become orphans (no static definition, no discoverLayout to resolve them)
    // and must be dropped so the dashboard doesn't render undefined slots.
    state.discoverLayout = null;
    // (Layout still in legacy size form here; v20 will normalize to spans.)
  }
  if (version < 22) {
    // dashboardLayout moved to server-side storage. Strip any remnants from the
    // persisted client state so they don't linger as inert junk in localStorage.
    delete state.dashboardLayout;
  }
  if (version < 24) {
    state.requestsTab = 'requests';
    state.requestsFilter = 'pending';
  }
  if (version < 25) {
    state.musicView = 'posters';
    state.musicPosterSize = 'medium';
    state.musicSort = 'sortName';
    state.musicSearch = '';
    state.musicSortDirection = 'asc';
    state.musicFilter = [];
    state.musicVisibleFields = { ...DEFAULT_MUSIC_FIELDS };
  }
  if (version < 26) {
    // activityFilterBy moved from a single source string to a multi-select array
    // (empty = all).
    const prev = state.activityFilterBy;
    state.activityFilterBy = typeof prev === 'string'
      ? (prev && prev !== 'all' ? [prev] : [])
      : Array.isArray(prev) ? prev : [];
  }
  if (version < 27) {
    state.seriesInstanceFilter = 'all';
    state.moviesInstanceFilter = 'all';
    state.musicInstanceFilter = 'all';
  }
  if (version < 28) {
    state.calendarInstanceFilter = 'all';
    state.activityInstanceFilter = 'all';
  }
  if (version < 29) {
    state.insightsDateFrom = null;
    state.insightsDateTo = null;
  }
  if (version < 30) {
    state.searchHistory = {};
  }
  if (version < 31) {
    state.requestsUserFilter = null;
  }
  if (version < 32) {
    state.requestsTypeFilter = [];
  }
  if (version < 33) {
    state.requestsSort = 'added';
    state.requestsSortDirection = 'desc';
  }
  if (version < 34) {
    state.moviesWatchFilter = 'all';
    state.seriesWatchFilter = 'all';
  }
  if (version < 35) {
    state.calendarShowScheduled = true;
  }
  if (version < 36) {
    for (const key of ['moviesVisibleFields', 'seriesVisibleFields'] as const) {
      const fields = state[key];
      if (!isVisibleFieldsByMode(fields)) continue;
      state[key] = {
        posters: fields.posters.includes('watchStatus') ? fields.posters : [...fields.posters, 'watchStatus'],
        overview: fields.overview.includes('watchStatus') ? fields.overview : [...fields.overview, 'watchStatus'],
        table: fields.table.includes('watchStatus') ? fields.table : [...fields.table, 'watchStatus'],
      };
    }
  }
  if (version < 37) {
    for (const key of ['moviesVisibleFields', 'seriesVisibleFields'] as const) {
      const fields = state[key];
      if (!isVisibleFieldsByMode(fields)) continue;
      state[key] = {
        posters: fields.posters.includes('title') ? fields.posters : ['title', ...fields.posters],
        overview: fields.overview.includes('title') ? fields.overview : ['title', ...fields.overview],
        table: fields.table.includes('title') ? fields.table : [...fields.table.slice(0, 1), 'title', ...fields.table.slice(1)],
      };
    }
  }
  if (version < 38) {
    // Existing users keep their current (custom) look; Liquid Glass is the
    // default only for NEW users (store initial values, no persisted state).
    state.liquidGlass = false;
    state.glassMode = DEFAULT_GLASS_MODE;
    state.glassIntensity = DEFAULT_GLASS_INTENSITY;
  }
  if (!isMediaWatchFilterPreference(state.moviesWatchFilter)) {
    state.moviesWatchFilter = 'all';
  }
  if (!isMediaWatchFilterPreference(state.seriesWatchFilter)) {
    state.seriesWatchFilter = 'all';
  }
  return state;
}

interface UIState {
  hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  mediaView: 'grid' | 'list';
  setMediaView: (view: 'grid' | 'list') => void;
  calendarView: 'month' | 'week' | 'agenda';
  setCalendarView: (view: 'month' | 'week' | 'agenda') => void;
  // Movies preferences
  moviesView: MediaViewMode;
  setMoviesView: (view: MediaViewMode) => void;
  moviesPosterSize: PosterSize;
  setMoviesPosterSize: (size: PosterSize) => void;
  moviesSort: string;
  setMoviesSort: (sort: string) => void;
  moviesSearch: string;
  setMoviesSearch: (search: string) => void;
  moviesSortDirection: 'asc' | 'desc';
  setMoviesSortDirection: (dir: 'asc' | 'desc') => void;
  moviesFilter: string[];
  setMoviesFilter: (filter: string[]) => void;
  moviesInstanceFilter: string;
  setMoviesInstanceFilter: (id: string) => void;
  moviesWatchFilter: MediaWatchFilterPreference;
  setMoviesWatchFilter: (filter: MediaWatchFilterPreference) => void;
  moviesVisibleFields: VisibleFieldsByMode;
  setMoviesVisibleFields: (mode: MediaViewMode, fields: string[]) => void;
  // Series preferences
  seriesView: MediaViewMode;
  setSeriesView: (view: MediaViewMode) => void;
  seriesPosterSize: PosterSize;
  setSeriesPosterSize: (size: PosterSize) => void;
  seriesSort: string;
  setSeriesSort: (sort: string) => void;
  seriesSearch: string;
  setSeriesSearch: (search: string) => void;
  seriesSortDirection: 'asc' | 'desc';
  setSeriesSortDirection: (dir: 'asc' | 'desc') => void;
  seriesFilter: string[];
  setSeriesFilter: (filter: string[]) => void;
  seriesInstanceFilter: string;
  setSeriesInstanceFilter: (id: string) => void;
  seriesWatchFilter: MediaWatchFilterPreference;
  setSeriesWatchFilter: (filter: MediaWatchFilterPreference) => void;
  seriesVisibleFields: VisibleFieldsByMode;
  setSeriesVisibleFields: (mode: MediaViewMode, fields: string[]) => void;
  // Music preferences (artist-centric)
  musicView: MediaViewMode;
  setMusicView: (view: MediaViewMode) => void;
  musicPosterSize: PosterSize;
  setMusicPosterSize: (size: PosterSize) => void;
  musicSort: string;
  setMusicSort: (sort: string) => void;
  musicSearch: string;
  setMusicSearch: (search: string) => void;
  musicSortDirection: 'asc' | 'desc';
  setMusicSortDirection: (dir: 'asc' | 'desc') => void;
  musicFilter: string[];
  setMusicFilter: (filter: string[]) => void;
  musicInstanceFilter: string;
  setMusicInstanceFilter: (id: string) => void;
  musicVisibleFields: VisibleFieldsByMode;
  setMusicVisibleFields: (mode: MediaViewMode, fields: string[]) => void;
  // Discover preferences
  discoverContentType: DiscoverContentType;
  setDiscoverContentType: (type: DiscoverContentType) => void;
  discoverSort: string;
  setDiscoverSort: (sort: string) => void;
  discoverSortDirection: 'asc' | 'desc';
  setDiscoverSortDirection: (dir: 'asc' | 'desc') => void;
  discoverFilters: DiscoverFiltersState;
  setDiscoverFilters: (filters: DiscoverFiltersState) => void;
  // Anime preferences
  animeSort: string;
  setAnimeSort: (sort: string) => void;
  animeFilters: AnimeFiltersState;
  setAnimeFilters: (filters: AnimeFiltersState) => void;
  // Torrents preferences
  torrentsFilter: TorrentsFilterPreference[];
  setTorrentsFilter: (filter: TorrentsFilterPreference[]) => void;
  torrentsSortKey: TorrentsSortKeyPreference;
  setTorrentsSortKey: (sortKey: TorrentsSortKeyPreference) => void;
  torrentsSortDir: TorrentsSortDirectionPreference;
  setTorrentsSortDir: (dir: TorrentsSortDirectionPreference) => void;
  // Activity preferences
  activityTab: ActivityTabPreference;
  setActivityTab: (tab: ActivityTabPreference) => void;
  activitySortBy: ActivitySortPreference;
  setActivitySortBy: (sortBy: ActivitySortPreference) => void;
  // Empty array = all sources. Multi-select set of sources (sonarr/radarr/lidarr).
  activityFilterBy: string[];
  setActivityFilterBy: (filterBy: string[]) => void;
  // 'all' or a specific ServiceConnection id (instanceId). Only surfaced when a
  // type has >1 instance.
  activityInstanceFilter: string;
  setActivityInstanceFilter: (id: string) => void;
  // Requests page (Seerr)
  requestsTab: RequestsTabPreference;
  setRequestsTab: (tab: RequestsTabPreference) => void;
  requestsFilter: RequestsFilterPreference;
  setRequestsFilter: (filter: RequestsFilterPreference) => void;
  /** Seerr user id to filter requests by; null = all users (admin-only UI). */
  requestsUserFilter: number | null;
  setRequestsUserFilter: (userId: number | null) => void;
  /** Empty = all types. Single-type selection uses ?mediaType= server-side. */
  requestsTypeFilter: RequestsTypeFilterPreference;
  setRequestsTypeFilter: (filter: RequestsTypeFilterPreference) => void;
  requestsSort: RequestsSortPreference;
  setRequestsSort: (sort: RequestsSortPreference) => void;
  requestsSortDirection: RequestsSortDirectionPreference;
  setRequestsSortDirection: (dir: RequestsSortDirectionPreference) => void;
  // Notifications filters
  notificationsFilters: NotificationsFiltersState;
  setNotificationsSearch: (search: string) => void;
  setNotificationsEventTypes: (eventTypes: string[]) => void;
  setNotificationsReadState: (state: NotificationsReadStatePreference) => void;
  setNotificationsDateRange: (from: string | null, to: string | null) => void;
  resetNotificationsFilters: () => void;
  // Cleanup history filters
  cleanupHistoryFilters: CleanupHistoryFiltersState;
  setCleanupHistoryFilters: (filters: Partial<CleanupHistoryFiltersState>) => void;
  resetCleanupHistoryFilters: () => void;
  // Insights page date range (ISO date strings, e.g. "2026-05-12"); null → default last-30-days at render
  insightsDateFrom: string | null;
  insightsDateTo: string | null;
  setInsightsDateRange: (from: string | null, to: string | null) => void;
  // Calendar preferences
  calendarTypeFilter: 'all' | 'episode' | 'movie' | 'album';
  setCalendarTypeFilter: (filter: 'all' | 'episode' | 'movie' | 'album') => void;
  calendarMonitoredOnly: boolean;
  setCalendarMonitoredOnly: (v: boolean) => void;
  calendarInstanceFilter: string;
  setCalendarInstanceFilter: (id: string) => void;
  calendarShowScheduled: boolean;
  setCalendarShowScheduled: (v: boolean) => void;
  // Navigation preferences
  navPosition: 'top' | 'bottom';
  setNavPosition: (position: 'top' | 'bottom') => void;
  navOrder: NavItemId[];
  disabledNavItems: NavItemId[];
  defaultPage: NavItemId;
  setNavOrder: (order: NavItemId[]) => void;
  toggleNavItem: (id: NavItemId) => void;
  setDefaultPage: (id: NavItemId) => void;
  resetNavConfig: () => void;
  // Anime carousel order
  animeCarouselOrder: AnimeCarouselId[];
  disabledAnimeCarousels: AnimeCarouselId[];
  setAnimeCarouselOrder: (order: AnimeCarouselId[]) => void;
  toggleAnimeCarousel: (id: AnimeCarouselId) => void;
  resetAnimeCarouselConfig: () => void;
  // Dashboard edit mode (the layout itself lives server-side; see /api/dashboard-layouts)
  dashboardEditMode: boolean;
  setDashboardEditMode: (editing: boolean) => void;
  // Dashboard theme (Bento — see src/lib/dashboard-theme.ts)
  dashboardAccent: DashboardAccent;
  dashboardPalette: DashboardPalette;
  dashboardGradient: DashboardGradient;
  dashboardFont: DashboardFont;
  dashboardFg?: string;
  dashboardFgMute?: string;
  dashboardFgSubtle?: string;
  setDashboardAccent: (a: DashboardAccent) => void;
  setDashboardPalette: (p: DashboardPalette) => void;
  setDashboardGradient: (g: DashboardGradient) => void;
  setDashboardFont: (f: DashboardFont) => void;
  setDashboardFg: (c: string | undefined) => void;
  setDashboardFgMute: (c: string | undefined) => void;
  setDashboardFgSubtle: (c: string | undefined) => void;
  resetDashboardTheme: () => void;
  // Liquid Glass mode (Apple system materials). Enabling it never touches the
  // dashboard* prefs above — they stay stored and are restored on toggle-off.
  liquidGlass: boolean;
  glassMode: GlassMode;
  glassIntensity: number;
  setLiquidGlass: (on: boolean) => void;
  setGlassMode: (m: GlassMode) => void;
  setGlassIntensity: (n: number) => void;
  // Discover layout (server-side, cached locally for dashboard widget catalog)
  discoverLayout: DiscoverLayoutConfig | null;
  setDiscoverLayout: (config: DiscoverLayoutConfig | null) => void;
  // Recent-search history, keyed per search bar. Most-recent-first, capped at 20.
  searchHistory: Record<string, string[]>;
  addSearchTerm: (key: string, term: string) => void;
  removeSearchTerm: (key: string, term: string) => void;
  // Settings import
  applyImportedUiPrefs: (partial: Record<string, unknown>) => void;
}

// Single source of truth for which UI state keys are persisted to localStorage
// AND accepted from imported settings files. Both `partialize` and
// `applyImportedUiPrefs` reference this list so they cannot drift apart.
const PERSISTED_KEYS = [
  'mediaView',
  'calendarView',
  'moviesView',
  'moviesPosterSize',
  'moviesSort',
  'moviesSearch',
  'moviesSortDirection',
  'moviesFilter',
  'moviesInstanceFilter',
  'moviesWatchFilter',
  'moviesVisibleFields',
  'seriesView',
  'seriesPosterSize',
  'seriesSort',
  'seriesSearch',
  'seriesSortDirection',
  'seriesFilter',
  'seriesInstanceFilter',
  'seriesWatchFilter',
  'seriesVisibleFields',
  'musicView',
  'musicPosterSize',
  'musicSort',
  'musicSearch',
  'musicSortDirection',
  'musicFilter',
  'musicInstanceFilter',
  'musicVisibleFields',
  'discoverContentType',
  'discoverSort',
  'discoverSortDirection',
  'discoverFilters',
  'animeSort',
  'animeFilters',
  'torrentsFilter',
  'torrentsSortKey',
  'torrentsSortDir',
  'activityTab',
  'activitySortBy',
  'activityFilterBy',
  'activityInstanceFilter',
  'requestsTab',
  'requestsFilter',
  'requestsUserFilter',
  'requestsTypeFilter',
  'requestsSort',
  'requestsSortDirection',
  'notificationsFilters',
  'cleanupHistoryFilters',
  'insightsDateFrom',
  'insightsDateTo',
  'calendarTypeFilter',
  'calendarMonitoredOnly',
  'calendarInstanceFilter',
  'calendarShowScheduled',
  'navPosition',
  'navOrder',
  'disabledNavItems',
  'defaultPage',
  'sidebarCollapsed',
  'animeCarouselOrder',
  'disabledAnimeCarousels',
  'discoverLayout',
  'dashboardAccent',
  'dashboardPalette',
  'dashboardGradient',
  'dashboardFont',
  'dashboardFg',
  'dashboardFgMute',
  'dashboardFgSubtle',
  'liquidGlass',
  'glassMode',
  'glassIntensity',
  'searchHistory',
] as const satisfies readonly (keyof UIState)[];

const PERSISTED_KEY_SET: ReadonlySet<string> = new Set(PERSISTED_KEYS);

// Keys whose persisted shape is an array. applyImportedUiPrefs drops values for
// these keys that aren't arrays — a string slipping in (e.g. an older "monitored"
// export) would break consumers that call .filter / .some / .includes on it.
const ARRAY_PERSISTED_KEYS: ReadonlySet<string> = new Set([
  'moviesFilter',
  'seriesFilter',
  'musicFilter',
  'activityFilterBy',
  'discoverFilters',
  'animeFilters',
  'torrentsFilter',
  'notificationsFilters',
  'navOrder',
  'disabledNavItems',
  'animeCarouselOrder',
  'disabledAnimeCarousels',
]);

// Keys whose persisted shape is a VisibleFieldsByMode object ({ posters, overview,
// table } of string arrays). These are NOT plain arrays, so applyImportedUiPrefs
// validates the object shape instead of treating them as array-only.
const VISIBLE_FIELDS_KEYS: ReadonlySet<string> = new Set([
  'moviesVisibleFields',
  'seriesVisibleFields',
  'musicVisibleFields',
]);

function isVisibleFieldsByMode(value: unknown): value is VisibleFieldsByMode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return (['posters', 'overview', 'table'] as const).every(
    (mode) => Array.isArray(obj[mode]) && (obj[mode] as unknown[]).every((f) => typeof f === 'string')
  );
}

// searchHistory is a plain object of string arrays (key -> recent terms). Imported
// files can be hand-edited, so validate the shape before accepting it.
function isSearchHistoryMap(value: unknown): value is Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (terms) => Array.isArray(terms) && terms.every((t) => typeof t === 'string')
  );
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      hasHydrated: false,
      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      mediaView: 'grid',
      setMediaView: (view) => set({ mediaView: view }),
      calendarView: 'agenda',
      setCalendarView: (view) => set({ calendarView: view }),
      // Movies
      moviesView: 'posters',
      setMoviesView: (view) => set({ moviesView: view }),
      moviesPosterSize: 'medium',
      setMoviesPosterSize: (size) => set({ moviesPosterSize: size }),
      moviesSort: 'title',
      setMoviesSort: (sort) => set({ moviesSort: sort }),
      moviesSearch: '',
      setMoviesSearch: (search) => set({ moviesSearch: search }),
      moviesSortDirection: 'asc',
      setMoviesSortDirection: (dir) => set({ moviesSortDirection: dir }),
      moviesFilter: [],
      setMoviesFilter: (filter) => set({ moviesFilter: filter }),
      moviesInstanceFilter: 'all',
      setMoviesInstanceFilter: (id) => set({ moviesInstanceFilter: id }),
      moviesWatchFilter: 'all',
      setMoviesWatchFilter: (filter) => set({ moviesWatchFilter: filter }),
      moviesVisibleFields: { ...DEFAULT_MOVIES_FIELDS },
      setMoviesVisibleFields: (mode, fields) => set((state) => ({
        moviesVisibleFields: { ...state.moviesVisibleFields, [mode]: fields },
      })),
      // Series
      seriesView: 'posters',
      setSeriesView: (view) => set({ seriesView: view }),
      seriesPosterSize: 'medium',
      setSeriesPosterSize: (size) => set({ seriesPosterSize: size }),
      seriesSort: 'title',
      setSeriesSort: (sort) => set({ seriesSort: sort }),
      seriesSearch: '',
      setSeriesSearch: (search) => set({ seriesSearch: search }),
      seriesSortDirection: 'asc',
      setSeriesSortDirection: (dir) => set({ seriesSortDirection: dir }),
      seriesFilter: [],
      setSeriesFilter: (filter) => set({ seriesFilter: filter }),
      seriesInstanceFilter: 'all',
      setSeriesInstanceFilter: (id) => set({ seriesInstanceFilter: id }),
      seriesWatchFilter: 'all',
      setSeriesWatchFilter: (filter) => set({ seriesWatchFilter: filter }),
      seriesVisibleFields: { ...DEFAULT_SERIES_FIELDS },
      setSeriesVisibleFields: (mode, fields) => set((state) => ({
        seriesVisibleFields: { ...state.seriesVisibleFields, [mode]: fields },
      })),
      // Music (artist-centric)
      musicView: 'posters',
      setMusicView: (view) => set({ musicView: view }),
      musicPosterSize: 'medium',
      setMusicPosterSize: (size) => set({ musicPosterSize: size }),
      musicSort: 'sortName',
      setMusicSort: (sort) => set({ musicSort: sort }),
      musicSearch: '',
      setMusicSearch: (search) => set({ musicSearch: search }),
      musicSortDirection: 'asc',
      setMusicSortDirection: (dir) => set({ musicSortDirection: dir }),
      musicFilter: [],
      setMusicFilter: (filter) => set({ musicFilter: filter }),
      musicInstanceFilter: 'all',
      setMusicInstanceFilter: (id) => set({ musicInstanceFilter: id }),
      musicVisibleFields: { ...DEFAULT_MUSIC_FIELDS },
      setMusicVisibleFields: (mode, fields) => set((state) => ({
        musicVisibleFields: { ...state.musicVisibleFields, [mode]: fields },
      })),
      // Discover
      discoverContentType: 'all',
      setDiscoverContentType: (type) => set({ discoverContentType: type }),
      discoverSort: 'trending',
      setDiscoverSort: (sort) => set({ discoverSort: sort }),
      discoverSortDirection: 'desc',
      setDiscoverSortDirection: (dir) => set({ discoverSortDirection: dir }),
      discoverFilters: cloneDiscoverFilters(DEFAULT_DISCOVER_FILTERS),
      setDiscoverFilters: (filters) => set({ discoverFilters: cloneDiscoverFilters(filters) }),
      // Anime
      animeSort: 'seasonal',
      setAnimeSort: (sort) => set({ animeSort: sort }),
      animeFilters: cloneAnimeFilters(DEFAULT_ANIME_FILTERS),
      setAnimeFilters: (filters) => set({ animeFilters: cloneAnimeFilters(filters) }),
      // Torrents
      torrentsFilter: [],
      setTorrentsFilter: (filter) => set({ torrentsFilter: filter }),
      torrentsSortKey: 'added_on',
      setTorrentsSortKey: (sortKey) => set({ torrentsSortKey: sortKey }),
      torrentsSortDir: 'desc',
      setTorrentsSortDir: (dir) => set({ torrentsSortDir: dir }),
      // Activity
      activityTab: 'queue',
      setActivityTab: (tab) => set({ activityTab: tab }),
      activitySortBy: 'progress',
      setActivitySortBy: (sortBy) => set({ activitySortBy: sortBy }),
      activityFilterBy: [],
      setActivityFilterBy: (filterBy) => set({ activityFilterBy: filterBy }),
      activityInstanceFilter: 'all',
      setActivityInstanceFilter: (id) => set({ activityInstanceFilter: id }),
      // Requests
      requestsTab: 'requests',
      setRequestsTab: (tab) => set({ requestsTab: tab }),
      requestsFilter: 'pending',
      setRequestsFilter: (filter) => set({ requestsFilter: filter }),
      requestsUserFilter: null,
      setRequestsUserFilter: (userId) => set({ requestsUserFilter: userId }),
      requestsTypeFilter: [],
      setRequestsTypeFilter: (filter) => set({ requestsTypeFilter: filter }),
      requestsSort: 'added',
      setRequestsSort: (sort) => set({ requestsSort: sort }),
      requestsSortDirection: 'desc',
      setRequestsSortDirection: (dir) => set({ requestsSortDirection: dir }),
      // Notifications filters
      notificationsFilters: cloneNotificationsFilters(DEFAULT_NOTIFICATIONS_FILTERS),
      setNotificationsSearch: (search) =>
        set((state) => ({ notificationsFilters: { ...state.notificationsFilters, search } })),
      setNotificationsEventTypes: (eventTypes) =>
        set((state) => ({ notificationsFilters: { ...state.notificationsFilters, eventTypes: [...eventTypes] } })),
      setNotificationsReadState: (readState) =>
        set((state) => ({ notificationsFilters: { ...state.notificationsFilters, readState } })),
      setNotificationsDateRange: (dateFrom, dateTo) =>
        set((state) => ({ notificationsFilters: { ...state.notificationsFilters, dateFrom, dateTo } })),
      resetNotificationsFilters: () =>
        set({ notificationsFilters: cloneNotificationsFilters(DEFAULT_NOTIFICATIONS_FILTERS) }),
      cleanupHistoryFilters: cloneCleanupHistoryFilters(DEFAULT_CLEANUP_HISTORY_FILTERS),
      setCleanupHistoryFilters: (partial) =>
        set((state) => ({
          cleanupHistoryFilters: {
            ...state.cleanupHistoryFilters,
            ...partial,
            cleaner: partial.cleaner ? [...partial.cleaner] : state.cleanupHistoryFilters.cleaner,
            strikeType: partial.strikeType ? [...partial.strikeType] : state.cleanupHistoryFilters.strikeType,
            ruleId: partial.ruleId ? [...partial.ruleId] : state.cleanupHistoryFilters.ruleId,
            action: partial.action ? [...partial.action] : (state.cleanupHistoryFilters.action ?? []),
            reSearched: 'reSearched' in partial
              ? (partial.reSearched ?? null)
              : (state.cleanupHistoryFilters.reSearched ?? null),
          },
        })),
      resetCleanupHistoryFilters: () =>
        set({ cleanupHistoryFilters: cloneCleanupHistoryFilters(DEFAULT_CLEANUP_HISTORY_FILTERS) }),
      // Insights date range
      insightsDateFrom: null,
      insightsDateTo: null,
      setInsightsDateRange: (from, to) => set({ insightsDateFrom: from, insightsDateTo: to }),
      // Calendar
      calendarTypeFilter: 'all',
      setCalendarTypeFilter: (filter) => set({ calendarTypeFilter: filter }),
      calendarMonitoredOnly: false,
      setCalendarMonitoredOnly: (v) => set({ calendarMonitoredOnly: v }),
      calendarInstanceFilter: 'all',
      setCalendarInstanceFilter: (id) => set({ calendarInstanceFilter: id }),
      calendarShowScheduled: true,
      setCalendarShowScheduled: (v) => set({ calendarShowScheduled: v }),
      // Navigation
      navPosition: 'top',
      setNavPosition: (position: 'top' | 'bottom') => set({ navPosition: position }),
      navOrder: [...DEFAULT_NAV_ORDER],
      disabledNavItems: [],
      defaultPage: 'dashboard' as NavItemId,
      setNavOrder: (order) => set({ navOrder: order }),
      toggleNavItem: (id) =>
        set((state) => {
          const reconciledOrder = reconcileNavOrder(state.navOrder);
          // Refuse to disable pinned items
          if (NAV_ITEM_MAP[id]?.pinned) return { navOrder: reconciledOrder };
          const isDisabled = state.disabledNavItems.includes(id);
          if (isDisabled) {
            // Re-enable
            return {
              navOrder: reconciledOrder,
              disabledNavItems: state.disabledNavItems.filter((i) => i !== id),
            };
          }
          // Check: at least 1 non-Settings item must remain enabled
          const disabledSet = new Set(state.disabledNavItems);
          disabledSet.add(id);
          const enabledNonPinned = reconciledOrder.filter(
            (i) => !disabledSet.has(i) && !NAV_ITEM_MAP[i]?.pinned
          );
          if (enabledNonPinned.length === 0) return { navOrder: reconciledOrder };
          // If disabling the current default page, reset default to first enabled non-pinned item
          const updates: Partial<UIState> = {
            navOrder: reconciledOrder,
            disabledNavItems: [...state.disabledNavItems, id],
          };
          if (state.defaultPage === id) {
            updates.defaultPage = enabledNonPinned[0];
          }
          return updates;
        }),
      setDefaultPage: (id) => set({ defaultPage: id }),
      resetNavConfig: () => set({ navOrder: [...DEFAULT_NAV_ORDER], disabledNavItems: [], defaultPage: 'dashboard' as NavItemId }),
      // Anime carousel order
      animeCarouselOrder: [...DEFAULT_ANIME_CAROUSEL_ORDER],
      disabledAnimeCarousels: [],
      setAnimeCarouselOrder: (order) => set({ animeCarouselOrder: order }),
      toggleAnimeCarousel: (id) =>
        set((state) => {
          const isDisabled = state.disabledAnimeCarousels.includes(id);
          if (isDisabled) {
            return { disabledAnimeCarousels: state.disabledAnimeCarousels.filter((i) => i !== id) };
          }
          return { disabledAnimeCarousels: [...state.disabledAnimeCarousels, id] };
        }),
      resetAnimeCarouselConfig: () => set({ animeCarouselOrder: [...DEFAULT_ANIME_CAROUSEL_ORDER], disabledAnimeCarousels: [] }),
      // Dashboard edit mode
      dashboardEditMode: false,
      setDashboardEditMode: (editing) => set({ dashboardEditMode: editing }),
      // Dashboard theme
      dashboardAccent: DEFAULT_DASHBOARD_THEME.accent,
      dashboardPalette: DEFAULT_DASHBOARD_THEME.palette,
      dashboardGradient: DEFAULT_DASHBOARD_THEME.gradient,
      dashboardFont: DEFAULT_DASHBOARD_THEME.font,
      dashboardFg: undefined,
      dashboardFgMute: undefined,
      dashboardFgSubtle: undefined,
      setDashboardAccent: (a) => set({ dashboardAccent: a }),
      setDashboardPalette: (p) => set({ dashboardPalette: p }),
      setDashboardGradient: (g) => set({ dashboardGradient: g }),
      setDashboardFont: (f) => set({ dashboardFont: f }),
      setDashboardFg: (c) => set({ dashboardFg: c }),
      setDashboardFgMute: (c) => set({ dashboardFgMute: c }),
      setDashboardFgSubtle: (c) => set({ dashboardFgSubtle: c }),
      resetDashboardTheme: () =>
        set({
          dashboardAccent: DEFAULT_DASHBOARD_THEME.accent,
          dashboardPalette: DEFAULT_DASHBOARD_THEME.palette,
          dashboardGradient: DEFAULT_DASHBOARD_THEME.gradient,
          dashboardFont: DEFAULT_DASHBOARD_THEME.font,
          dashboardFg: undefined,
          dashboardFgMute: undefined,
          dashboardFgSubtle: undefined,
          liquidGlass: DEFAULT_LIQUID_GLASS,
          glassMode: DEFAULT_GLASS_MODE,
          glassIntensity: DEFAULT_GLASS_INTENSITY,
        }),
      // Liquid Glass
      liquidGlass: DEFAULT_LIQUID_GLASS,
      glassMode: DEFAULT_GLASS_MODE,
      glassIntensity: DEFAULT_GLASS_INTENSITY,
      setLiquidGlass: (on) => set({ liquidGlass: on }),
      setGlassMode: (m) => set({ glassMode: m }),
      setGlassIntensity: (n) =>
        set({ glassIntensity: Math.min(100, Math.max(0, Math.round(n))) }),
      // Discover layout cache
      discoverLayout: null,
      setDiscoverLayout: (config) =>
        set(() => ({
          discoverLayout: config ? reconcileDiscoverLayout(config) : null,
        })),
      searchHistory: {},
      addSearchTerm: (key, term) =>
        set((state) => {
          const t = term.trim();
          if (!t) return {};
          const prev = state.searchHistory[key] ?? [];
          const next = [t, ...prev.filter((h) => h.toLowerCase() !== t.toLowerCase())].slice(0, 20);
          return { searchHistory: { ...state.searchHistory, [key]: next } };
        }),
      removeSearchTerm: (key, term) =>
        set((state) => {
          const prev = state.searchHistory[key] ?? [];
          return { searchHistory: { ...state.searchHistory, [key]: prev.filter((h) => h !== term) } };
        }),
      applyImportedUiPrefs: (partial) =>
        set((state) => {
          const next: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(partial)) {
            if (!PERSISTED_KEY_SET.has(key)) continue;
            // Imported files can be hand-edited or come from an older export
            // where a string field has since become an array (e.g. moviesFilter).
            // Drop values whose shape would break call sites.
            if (VISIBLE_FIELDS_KEYS.has(key)) {
              if (!isVisibleFieldsByMode(value)) continue;
              next[key] = value;
              continue;
            }
            if (key === 'searchHistory') {
              if (!isSearchHistoryMap(value)) continue;
              next[key] = value;
              continue;
            }
            if (WATCH_FILTER_PERSISTED_KEYS.has(key)) {
              if (!isMediaWatchFilterPreference(value)) continue;
              next[key] = value;
              continue;
            }
            if (key === 'liquidGlass') {
              if (typeof value !== 'boolean') continue;
              next[key] = value;
              continue;
            }
            if (key === 'glassMode') {
              if (value !== 'light' && value !== 'dark' && value !== 'system') continue;
              next[key] = value;
              continue;
            }
            if (key === 'glassIntensity') {
              if (typeof value !== 'number' || !Number.isFinite(value)) continue;
              next[key] = Math.min(100, Math.max(0, Math.round(value)));
              continue;
            }
            if (ARRAY_PERSISTED_KEYS.has(key) && !Array.isArray(value)) continue;
            next[key] = value;
          }
          const rawIncomingDiscoverLayout =
            'discoverLayout' in next && next.discoverLayout && typeof next.discoverLayout === 'object'
              ? (next.discoverLayout as DiscoverLayoutConfig)
              : null;
          const incomingDiscoverLayout = rawIncomingDiscoverLayout
            ? reconcileDiscoverLayout(rawIncomingDiscoverLayout)
            : state.discoverLayout;
          if (rawIncomingDiscoverLayout) {
            next.discoverLayout = incomingDiscoverLayout;
          }
          if ('navOrder' in next && Array.isArray(next.navOrder)) {
            next.navOrder = reconcileNavOrder(next.navOrder as NavItemId[]);
          }
          return { ...state, ...(next as Partial<UIState>) };
        }),
    }),
    {
      name: UI_PREFS_STORAGE_KEY,
      // Bump STORE_VERSION whenever new persisted fields are added
      version: STORE_VERSION,
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      migrate: (persisted, version) => migrateUiPrefs(persisted, version) as unknown as UIState,
      partialize: (state) =>
        Object.fromEntries(PERSISTED_KEYS.map((k) => [k, state[k]])) as Partial<UIState>,
    }
  )
);
