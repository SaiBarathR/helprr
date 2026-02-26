import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type NavItemId, DEFAULT_NAV_ORDER, NAV_ITEM_MAP, reconcileNavOrder,
} from '@/lib/nav-config';
import type { DiscoverContentType } from '@/types';

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
  releaseState: '',
};

function cloneDiscoverFilters(filters: DiscoverFiltersState): DiscoverFiltersState {
  return {
    ...filters,
    genres: [...filters.genres],
    providers: [...filters.providers],
    networks: [...filters.networks],
  };
}

interface UIState {
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
  moviesFilter: string;
  setMoviesFilter: (filter: string) => void;
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
  seriesFilter: string;
  setSeriesFilter: (filter: string) => void;
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
  // Calendar preferences
  calendarTypeFilter: 'all' | 'episode' | 'movie';
  setCalendarTypeFilter: (filter: 'all' | 'episode' | 'movie') => void;
  calendarMonitoredOnly: boolean;
  setCalendarMonitoredOnly: (v: boolean) => void;
  // Navigation preferences
  navOrder: NavItemId[];
  disabledNavItems: NavItemId[];
  defaultPage: NavItemId;
  setNavOrder: (order: NavItemId[]) => void;
  toggleNavItem: (id: NavItemId) => void;
  setDefaultPage: (id: NavItemId) => void;
  resetNavConfig: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
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
      moviesFilter: 'all',
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
      seriesFilter: 'all',
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
      // Calendar
      calendarTypeFilter: 'all',
      setCalendarTypeFilter: (filter) => set({ calendarTypeFilter: filter }),
      calendarMonitoredOnly: false,
      setCalendarMonitoredOnly: (v) => set({ calendarMonitoredOnly: v }),
      // Navigation
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
    }),
    {
      name: 'helprr-ui-prefs',
      version: 5,
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        if (version === 0) {
          // Migrate flat string[] to per-mode VisibleFieldsByMode
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
          // Add navigation preferences
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
        return state as unknown as UIState;
      },
      partialize: (state) => ({
        mediaView: state.mediaView,
        calendarView: state.calendarView,
        moviesView: state.moviesView,
        moviesPosterSize: state.moviesPosterSize,
        moviesSort: state.moviesSort,
        moviesSearch: state.moviesSearch,
        moviesSortDirection: state.moviesSortDirection,
        moviesFilter: state.moviesFilter,
        moviesVisibleFields: state.moviesVisibleFields,
        seriesView: state.seriesView,
        seriesPosterSize: state.seriesPosterSize,
        seriesSort: state.seriesSort,
        seriesSearch: state.seriesSearch,
        seriesSortDirection: state.seriesSortDirection,
        seriesFilter: state.seriesFilter,
        seriesVisibleFields: state.seriesVisibleFields,
        discoverContentType: state.discoverContentType,
        discoverSort: state.discoverSort,
        discoverSortDirection: state.discoverSortDirection,
        discoverFilters: state.discoverFilters,
        calendarTypeFilter: state.calendarTypeFilter,
        calendarMonitoredOnly: state.calendarMonitoredOnly,
        navOrder: state.navOrder,
        disabledNavItems: state.disabledNavItems,
        defaultPage: state.defaultPage,
      }),
    }
  )
);
