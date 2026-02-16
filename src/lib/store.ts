import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type MediaViewMode = 'posters' | 'overview' | 'table';
export type PosterSize = 'small' | 'medium' | 'large';
export type VisibleFieldsByMode = Record<MediaViewMode, string[]>;

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
  seriesSortDirection: 'asc' | 'desc';
  setSeriesSortDirection: (dir: 'asc' | 'desc') => void;
  seriesFilter: string;
  setSeriesFilter: (filter: string) => void;
  seriesVisibleFields: VisibleFieldsByMode;
  setSeriesVisibleFields: (mode: MediaViewMode, fields: string[]) => void;
  // Calendar preferences
  calendarTypeFilter: 'all' | 'episode' | 'movie';
  setCalendarTypeFilter: (filter: 'all' | 'episode' | 'movie') => void;
  calendarMonitoredOnly: boolean;
  setCalendarMonitoredOnly: (v: boolean) => void;
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
      seriesSortDirection: 'asc',
      setSeriesSortDirection: (dir) => set({ seriesSortDirection: dir }),
      seriesFilter: 'all',
      setSeriesFilter: (filter) => set({ seriesFilter: filter }),
      seriesVisibleFields: { ...DEFAULT_SERIES_FIELDS },
      setSeriesVisibleFields: (mode, fields) => set((state) => ({
        seriesVisibleFields: { ...state.seriesVisibleFields, [mode]: fields },
      })),
      // Calendar
      calendarTypeFilter: 'all',
      setCalendarTypeFilter: (filter) => set({ calendarTypeFilter: filter }),
      calendarMonitoredOnly: false,
      setCalendarMonitoredOnly: (v) => set({ calendarMonitoredOnly: v }),
    }),
    {
      name: 'helprr-ui-prefs',
      version: 1,
      migrate: (persisted, version) => {
        if (version === 0) {
          const state = persisted as Record<string, unknown>;
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
        return persisted as UIState;
      },
      partialize: (state) => ({
        mediaView: state.mediaView,
        calendarView: state.calendarView,
        moviesView: state.moviesView,
        moviesPosterSize: state.moviesPosterSize,
        moviesSort: state.moviesSort,
        moviesSortDirection: state.moviesSortDirection,
        moviesFilter: state.moviesFilter,
        moviesVisibleFields: state.moviesVisibleFields,
        seriesView: state.seriesView,
        seriesPosterSize: state.seriesPosterSize,
        seriesSort: state.seriesSort,
        seriesSortDirection: state.seriesSortDirection,
        seriesFilter: state.seriesFilter,
        seriesVisibleFields: state.seriesVisibleFields,
        calendarTypeFilter: state.calendarTypeFilter,
        calendarMonitoredOnly: state.calendarMonitoredOnly,
      }),
    }
  )
);
