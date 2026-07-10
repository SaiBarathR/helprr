'use client';
import { ApiError } from '@/lib/query-fetch';

import type { PlayActivityUser } from '@/types/jellyfin';
import type { WidgetProps } from '@/lib/widgets/types';
import { JellyfinStatsWidgetShell } from './jellyfin-widget-shell';
import { PlayActivityChart } from './jellyfin-stats-charts';

async function fetchPlayActivity({ days, userId }: { days: number; userId: string }): Promise<PlayActivityUser[]> {
  const params = new URLSearchParams({ days: String(days) });
  if (userId) params.set('userId', userId);
  const res = await fetch(`/api/jellyfin/playback/activity?${params}`);
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  const data = await res.json();
  return Array.isArray(data.data) ? data.data : [];
}

export function JellyfinPlayActivityWidget({ refreshInterval, editMode = false }: WidgetProps) {
  return (
    <JellyfinStatsWidgetShell<PlayActivityUser[]>
      widgetId="jellyfin-play-activity"
      title="Play Activity"
      refreshInterval={refreshInterval}
      editMode={editMode}
      fetchFn={fetchPlayActivity}
      refetchOnFocus
      isEmpty={(d) => !d || d.filter((u) => u.user_id !== 'labels_user').length === 0}
      initialDays={30}
      renderContent={(data, _sortBy, size) => <PlayActivityChart data={data ?? []} width={size.width} />}
    />
  );
}
