'use client';

import type { WidgetProps } from '@/lib/widgets/types';
import { JellyfinStatsWidgetShell } from './jellyfin-widget-shell';
import { HourlyHeatmap } from './jellyfin-stats-charts';

async function fetchHourly({ days, userId }: { days: number; userId: string }): Promise<Record<string, number>> {
  const params = new URLSearchParams({ days: String(days) });
  if (userId) params.set('userId', userId);
  const res = await fetch(`/api/jellyfin/playback/hourly?${params}`);
  if (!res.ok) return {};
  const data = await res.json();
  return (data.data && typeof data.data === 'object') ? data.data : {};
}

export function JellyfinHourlyActivityWidget({ refreshInterval, editMode = false }: WidgetProps) {
  return (
    <JellyfinStatsWidgetShell<Record<string, number>>
      widgetId="jellyfin-hourly-activity"
      title="Hourly Activity"
      refreshInterval={refreshInterval}
      editMode={editMode}
      fetchFn={fetchHourly}
      isEmpty={(d) => !d || Object.keys(d).length === 0}
      initialDays={30}
      renderContent={(data) => <HourlyHeatmap data={data ?? {}} />}
    />
  );
}
