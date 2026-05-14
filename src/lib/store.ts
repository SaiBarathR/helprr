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
import type { WidgetInstance, WidgetSize } from '@/lib/widgets/types';
import { DEFAULT_LAYOUT, getWidgetDefinition } from '@/lib/widgets/registry';

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
  posters: ['year', 'rating', 'monitored'],
  overview: ['qualityProfile', 'rating', 'studio', 'certification', 'sizeOnDisk', 'runtime', 'monitored', 'year', 'genres', 'overview', 'images'],
  table: ['monitored', 'year', 'qualityProfile', 'studio', 'rating', 'sizeOnDisk'],
};

const DEFAULT_SERIES_FIELDS: VisibleFieldsByMode = {
  posters: ['year', 'rating', 'monitored'],
  overview: ['qualityProfile', 'rating', 'network', 'sizeOnDisk', 'runtime', 'monitored', 'year', 'episodeProgress', 'genres', 'overview', 'images'],
  table: ['monitored', 'year', 'qualityProfile', 'network', 'episodeProgress', 'rating', 'sizeOnDisk'],
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
export type ActivityFilterPreference = 'all' | 'sonarr' | 'radarr';
export type NotificationsReadStatePreference = 'all' | 'unread' | 'read';

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

function normalizeWidgetSize(widgetId: string, size: WidgetSize): WidgetSize {
  const definition = getWidgetDefinition(widgetId);
  const requested = size === 'small' ? 'medium' : size;

  if (!definition) return requested;
  return definition.sizes.includes(requested) ? requested : definition.defaultSize;
}

function sanitizeDashboardLayout(layout: WidgetInstance[]): WidgetInstance[] {
  return layout
    .filter((item) => Boolean(getWidgetDefinition(item.widgetId)))
    .map((item) => ({
      ...item,
      size: normalizeWidgetSize(item.widgetId, item.size),
    }));
}

export const STORE_VERSION = 16;

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
    state.dashboardLayout = DEFAULT_LAYOUT.map((w) => ({ ...w }));
  }
  if (version < 7) {
    const rawLayout = Array.isArray(state.dashboardLayout)
      ? state.dashboardLayout as WidgetInstance[]
      : DEFAULT_LAYOUT.map((w) => ({ ...w }));
    state.dashboardLayout = sanitizeDashboardLayout(rawLayout);
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
    const layout = Array.isArray(state.dashboardLayout)
      ? state.dashboardLayout as WidgetInstance[]
      : [];
    const hadOld = layout.some(
      (w) => w.widgetId === 'torrent-summary' || w.widgetId === 'transfer-speed'
    );
    if (hadOld) {
      const firstIdx = layout.findIndex(
        (w) => w.widgetId === 'torrent-summary' || w.widgetId === 'transfer-speed'
      );
      const filtered = layout.filter(
        (w) => w.widgetId !== 'torrent-summary' && w.widgetId !== 'transfer-speed'
      );
      const combined: WidgetInstance = {
        id: `torrent-overview-1-${Date.now()}`,
        widgetId: 'torrent-overview',
        size: 'medium',
      };
      filtered.splice(firstIdx, 0, combined);
      state.dashboardLayout = filtered;
    }
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
  seriesVisibleFields: VisibleFieldsByMode;
  setSeriesVisibleFields: (mode: MediaViewMode, fields: string[]) => void;
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
  activityFilterBy: ActivityFilterPreference;
  setActivityFilterBy: (filterBy: ActivityFilterPreference) => void;
  // Notifications filters
  notificationsFilters: NotificationsFiltersState;
  setNotificationsSearch: (search: string) => void;
  setNotificationsEventTypes: (eventTypes: string[]) => void;
  setNotificationsReadState: (state: NotificationsReadStatePreference) => void;
  setNotificationsDateRange: (from: string | null, to: string | null) => void;
  resetNotificationsFilters: () => void;
  // Calendar preferences
  calendarTypeFilter: 'all' | 'episode' | 'movie';
  setCalendarTypeFilter: (filter: 'all' | 'episode' | 'movie') => void;
  calendarMonitoredOnly: boolean;
  setCalendarMonitoredOnly: (v: boolean) => void;
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
  // Dashboard widget layout
  dashboardLayout: WidgetInstance[];
  dashboardEditMode: boolean;
  setDashboardLayout: (layout: WidgetInstance[]) => void;
  setDashboardEditMode: (editing: boolean) => void;
  addWidget: (widgetId: string, size: WidgetSize) => void;
  removeWidget: (instanceId: string) => void;
  resizeWidget: (instanceId: string, size: WidgetSize) => void;
  reorderWidgets: (layout: WidgetInstance[]) => void;
  resetDashboardLayout: () => void;
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
  'moviesVisibleFields',
  'seriesView',
  'seriesPosterSize',
  'seriesSort',
  'seriesSearch',
  'seriesSortDirection',
  'seriesFilter',
  'seriesVisibleFields',
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
  'notificationsFilters',
  'calendarTypeFilter',
  'calendarMonitoredOnly',
  'navPosition',
  'navOrder',
  'disabledNavItems',
  'defaultPage',
  'dashboardLayout',
  'animeCarouselOrder',
  'disabledAnimeCarousels',
] as const satisfies readonly (keyof UIState)[];

const PERSISTED_KEY_SET: ReadonlySet<string> = new Set(PERSISTED_KEYS);

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
      seriesVisibleFields: { ...DEFAULT_SERIES_FIELDS },
      setSeriesVisibleFields: (mode, fields) => set((state) => ({
        seriesVisibleFields: { ...state.seriesVisibleFields, [mode]: fields },
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
      activityFilterBy: 'all',
      setActivityFilterBy: (filterBy) => set({ activityFilterBy: filterBy }),
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
      // Calendar
      calendarTypeFilter: 'all',
      setCalendarTypeFilter: (filter) => set({ calendarTypeFilter: filter }),
      calendarMonitoredOnly: false,
      setCalendarMonitoredOnly: (v) => set({ calendarMonitoredOnly: v }),
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
      // Dashboard widgets
      dashboardLayout: sanitizeDashboardLayout(DEFAULT_LAYOUT.map((w) => ({ ...w }))),
      dashboardEditMode: false,
      setDashboardLayout: (layout) => set({ dashboardLayout: sanitizeDashboardLayout(layout) }),
      setDashboardEditMode: (editing) => set({ dashboardEditMode: editing }),
      addWidget: (widgetId, size) =>
        set((state) => {
          const count = state.dashboardLayout.filter((w) => w.widgetId === widgetId).length;
          const instance: WidgetInstance = {
            id: `${widgetId}-${count + 1}-${Date.now()}`,
            widgetId,
            size: normalizeWidgetSize(widgetId, size),
          };
          return { dashboardLayout: sanitizeDashboardLayout([...state.dashboardLayout, instance]) };
        }),
      removeWidget: (instanceId) =>
        set((state) => ({
          dashboardLayout: state.dashboardLayout.filter((w) => w.id !== instanceId),
        })),
      resizeWidget: (instanceId, size) =>
        set((state) => ({
          dashboardLayout: sanitizeDashboardLayout(
            state.dashboardLayout.map((w) =>
              w.id === instanceId ? { ...w, size: normalizeWidgetSize(w.widgetId, size) } : w
            )
          ),
        })),
      reorderWidgets: (layout) => set({ dashboardLayout: sanitizeDashboardLayout(layout) }),
      resetDashboardLayout: () => set({ dashboardLayout: sanitizeDashboardLayout(DEFAULT_LAYOUT.map((w) => ({ ...w }))) }),
      applyImportedUiPrefs: (partial) =>
        set((state) => {
          const next: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(partial)) {
            if (PERSISTED_KEY_SET.has(key)) next[key] = value;
          }
          if ('dashboardLayout' in next && Array.isArray(next.dashboardLayout)) {
            next.dashboardLayout = sanitizeDashboardLayout(next.dashboardLayout as WidgetInstance[]);
          }
          if ('navOrder' in next && Array.isArray(next.navOrder)) {
            next.navOrder = reconcileNavOrder(next.navOrder as NavItemId[]);
          }
          return { ...state, ...(next as Partial<UIState>) };
        }),
    }),
    {
      name: 'helprr-ui-prefs',
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
