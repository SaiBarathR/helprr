'use client';
import { ApiError } from '@/lib/query-fetch';

import type { PlaybackBreakdownEntry } from '@/types/jellyfin';
import type { WidgetProps } from '@/lib/widgets/types';
import { JellyfinStatsWidgetShell } from './jellyfin-widget-shell';
import { PlaybackMethodBar } from './jellyfin-stats-charts';

async function fetchMethods({ days, userId }: { days: number; userId: string }): Promise<PlaybackBreakdownEntry[]> {
  const params = new URLSearchParams({ days: String(days) });
  if (userId) params.set('userId', userId);
  const res = await fetch(`/api/jellyfin/playback/breakdown/PlaybackMethod?${params}`);
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  const data = await res.json();
  return Array.isArray(data.entries) ? data.entries : [];
}

export function JellyfinPlaybackMethodsWidget({ refreshInterval, editMode = false }: WidgetProps) {
  return (
    <JellyfinStatsWidgetShell<PlaybackBreakdownEntry[]>
      widgetId="jellyfin-playback-methods"
      title="Playback Methods"
      refreshInterval={refreshInterval}
      editMode={editMode}
      fetchFn={fetchMethods}
      isEmpty={(d) => !d || d.length === 0}
      showSortToggle
      initialSort="duration"
      renderContent={(data, sortBy, size) => {
        // Detailed list lives under a fixed stacked-bar header (~50px overhead).
        const maxVisible = Math.max(2, Math.floor((size.height - 56) / 22));
        return <PlaybackMethodBar entries={data ?? []} sortBy={sortBy} maxVisible={maxVisible} />;
      }}
    />
  );
}
