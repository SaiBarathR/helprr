import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  mediaView: 'grid' | 'list';
  setMediaView: (view: 'grid' | 'list') => void;
  calendarView: 'month' | 'week' | 'agenda';
  setCalendarView: (view: 'month' | 'week' | 'agenda') => void;
  // Movies preferences
  moviesSort: string;
  setMoviesSort: (sort: string) => void;
  moviesSortDirection: 'asc' | 'desc';
  setMoviesSortDirection: (dir: 'asc' | 'desc') => void;
  moviesFilter: string;
  setMoviesFilter: (filter: string) => void;
  // Series preferences
  seriesSort: string;
  setSeriesSort: (sort: string) => void;
  seriesSortDirection: 'asc' | 'desc';
  setSeriesSortDirection: (dir: 'asc' | 'desc') => void;
  seriesFilter: string;
  setSeriesFilter: (filter: string) => void;
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
      moviesSort: 'title',
      setMoviesSort: (sort) => set({ moviesSort: sort }),
      moviesSortDirection: 'asc',
      setMoviesSortDirection: (dir) => set({ moviesSortDirection: dir }),
      moviesFilter: 'all',
      setMoviesFilter: (filter) => set({ moviesFilter: filter }),
      // Series
      seriesSort: 'title',
      setSeriesSort: (sort) => set({ seriesSort: sort }),
      seriesSortDirection: 'asc',
      setSeriesSortDirection: (dir) => set({ seriesSortDirection: dir }),
      seriesFilter: 'all',
      setSeriesFilter: (filter) => set({ seriesFilter: filter }),
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
        moviesSort: state.moviesSort,
        moviesSortDirection: state.moviesSortDirection,
        moviesFilter: state.moviesFilter,
        seriesSort: state.seriesSort,
        seriesSortDirection: state.seriesSortDirection,
        seriesFilter: state.seriesFilter,
        calendarTypeFilter: state.calendarTypeFilter,
        calendarMonitoredOnly: state.calendarMonitoredOnly,
      }),
    }
  )
);
