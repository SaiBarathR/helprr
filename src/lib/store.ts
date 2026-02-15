import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type MediaViewMode = 'posters' | 'overview' | 'table';
export type PosterSize = 'small' | 'medium' | 'large';

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
  moviesVisibleFields: string[];
  setMoviesVisibleFields: (fields: string[]) => void;
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
  seriesVisibleFields: string[];
  setSeriesVisibleFields: (fields: string[]) => void;
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
      moviesVisibleFields: ['qualityProfile', 'rating', 'studio', 'sizeOnDisk', 'monitored', 'year'],
      setMoviesVisibleFields: (fields) => set({ moviesVisibleFields: fields }),
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
      seriesVisibleFields: ['qualityProfile', 'rating', 'network', 'sizeOnDisk', 'monitored', 'episodeProgress', 'year'],
      setSeriesVisibleFields: (fields) => set({ seriesVisibleFields: fields }),
      // Calendar
      calendarTypeFilter: 'all',
      setCalendarTypeFilter: (filter) => set({ calendarTypeFilter: filter }),
      calendarMonitoredOnly: false,
      setCalendarMonitoredOnly: (v) => set({ calendarMonitoredOnly: v }),
    }),
    {
      name: 'helprr-ui-prefs',
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
