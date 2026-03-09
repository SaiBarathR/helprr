'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { SectionHeader } from '@/components/widgets/shared';
import type { WidgetProps } from '@/lib/widgets/types';

interface PlaybackData {
  data: Record<string, number>;
  pluginAvailable: boolean;
}

async function fetchPlaybackHourly(): Promise<PlaybackData> {
  const res = await fetch('/api/jellyfin/playback/hourly');
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function PlaybackChartWidget({ refreshInterval }: WidgetProps) {
  const { data, loading } = useWidgetData({
    fetchFn: fetchPlaybackHourly,
    refreshInterval: Math.max(refreshInterval, 60000), // Don't refresh faster than 1min
  });

  if (loading) {
    return (
      <div>
        <SectionHeader title="Playback Activity" />
        <Skeleton className="h-[200px] w-full rounded-xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <SectionHeader title="Playback Activity" />
        <div className="rounded-xl bg-card py-8 text-center">
          <p className="text-xs text-muted-foreground">No data available</p>
        </div>
      </div>
    );
  }

  if (!data.pluginAvailable) {
    return (
      <div>
        <SectionHeader title="Playback Activity" />
        <div className="rounded-xl bg-card py-8 text-center">
          <p className="text-xs text-muted-foreground">Playback Reporting Plugin required</p>
        </div>
      </div>
    );
  }

  // Aggregate all days into hourly totals
  const hourlyTotals = HOURS.map((hour) => {
    let total = 0;
    for (let day = 0; day < 7; day++) {
      total += data.data[`${day}-${hour}`] || 0;
    }
    return total;
  });

  const maxVal = Math.max(...hourlyTotals, 1);

  return (
    <div>
      <SectionHeader title="Playback Activity" href="/jellyfin" />
      <div className="rounded-xl bg-card p-4">
        <div className="flex items-end gap-[3px] h-[160px]">
          {hourlyTotals.map((val, hour) => {
            const heightPercent = (val / maxVal) * 100;
            return (
              <div key={hour} className="flex-1 flex flex-col items-center justify-end h-full">
                <div
                  className="w-full rounded-t bg-[#00a4dc]/70 min-h-[2px] transition-all"
                  style={{ height: `${Math.max(heightPercent, 1)}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-[3px] mt-1">
          {HOURS.map((h) => (
            <div key={h} className="flex-1 text-center">
              {h % 6 === 0 && (
                <span className="text-[8px] text-muted-foreground tabular-nums">
                  {h === 0 ? '12a' : h === 6 ? '6a' : h === 12 ? '12p' : '6p'}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
