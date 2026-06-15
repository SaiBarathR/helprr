'use client';
import { ApiError } from '@/lib/query-fetch';

import type { PlaybackBreakdownEntry } from '@/types/jellyfin';
import type { WidgetProps } from '@/lib/widgets/types';
import { JellyfinStatsWidgetShell } from './jellyfin-widget-shell';
import { RankedList } from './jellyfin-stats-charts';

async function fetchTopMovies({ days, userId }: { days: number; userId: string }): Promise<PlaybackBreakdownEntry[]> {
  const params = new URLSearchParams({ days: String(days) });
  if (userId) params.set('userId', userId);
  const res = await fetch(`/api/jellyfin/playback/movies?${params}`);
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  const data = await res.json();
  return Array.isArray(data.movies) ? data.movies : [];
}

export function JellyfinTopMoviesWidget({ refreshInterval, editMode = false }: WidgetProps) {
  return (
    <JellyfinStatsWidgetShell<PlaybackBreakdownEntry[]>
      widgetId="jellyfin-top-movies"
      title="Top Movies"
      refreshInterval={refreshInterval}
      editMode={editMode}
      fetchFn={fetchTopMovies}
      isEmpty={(d) => !d || d.length === 0}
      showSortToggle
      initialSort="duration"
      renderContent={(data, sortBy, size) => {
        const maxVisible = Math.max(2, Math.floor(size.height / 48));
        return <RankedList entries={data ?? []} sortBy={sortBy} maxVisible={maxVisible} />;
      }}
    />
  );
}
