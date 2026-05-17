'use client';

import type { PlaybackBreakdownEntry } from '@/types/jellyfin';
import type { WidgetProps } from '@/lib/widgets/types';
import { JellyfinStatsWidgetShell } from './jellyfin-widget-shell';
import { RankedList } from './jellyfin-stats-charts';

async function fetchTopClients({ days, userId }: { days: number; userId: string }): Promise<PlaybackBreakdownEntry[]> {
  const params = new URLSearchParams({ days: String(days) });
  if (userId) params.set('userId', userId);
  const res = await fetch(`/api/jellyfin/playback/breakdown/ClientName?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.entries) ? data.entries : [];
}

export function JellyfinTopClientsWidget({ refreshInterval, editMode = false }: WidgetProps) {
  return (
    <JellyfinStatsWidgetShell<PlaybackBreakdownEntry[]>
      widgetId="jellyfin-top-clients"
      title="Top Clients"
      refreshInterval={refreshInterval}
      editMode={editMode}
      fetchFn={fetchTopClients}
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
