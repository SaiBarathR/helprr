'use client';

import * as React from 'react';
import type { DateRange } from 'react-day-picker';
import { useUIStore } from '@/lib/store';
import { useCan } from '@/components/permission-provider';
import { DateRangeSelect } from '@/components/widgets/widget-filter-controls';
import { useInsightsResource, toDateKey, type InsightsRange } from '@/components/insights/insights-shared';
import { shiftDayKey } from '@/lib/insights';
import { KpiRow } from '@/components/insights/kpi-row';
import { ServiceHealthStrip } from '@/components/insights/service-health-strip';
import { LibraryGrowthCard } from '@/components/insights/library-growth-card';
import { LibraryGapsCard } from '@/components/insights/library-gaps-card';
import { DownloadSuccessCard } from '@/components/insights/download-success-card';
import { DownloadPipelineCard } from '@/components/insights/download-pipeline-card';
import { StorageInsightsCard } from '@/components/insights/storage-insights-card';
import { SeedingEconomicsCard } from '@/components/insights/seeding-economics-card';
import { TopIndexersCard } from '@/components/insights/top-indexers-card';
import { WatchStatsSection } from '@/components/insights/watch-stats-section';
import { JellyfinLibrariesCard } from '@/components/insights/jellyfin-libraries-card';
import type { ServicesStatsResponse } from '@/types/service-stats';

function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(fromKey: string, toKey: string): number {
  const a = keyToDate(fromKey).getTime();
  const b = keyToDate(toKey).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

export default function InsightsPage() {
  const insightsDateFrom = useUIStore((s) => s.insightsDateFrom);
  const insightsDateTo = useUIStore((s) => s.insightsDateTo);
  const setInsightsDateRange = useUIStore((s) => s.setInsightsDateRange);

  const canMovies = useCan('movies.view');
  const canSeries = useCan('series.view');
  const canMusic = useCan('music.view');
  const canProwlarr = useCan('prowlarr.view');
  const canJellyfin = useCan('jellyfin.view');
  const canWatchStats = useCan('jellyfin.stats');
  const canTorrents = useCan('torrents.view');

  // "Today" is captured once at mount (lazy initializer keeps render pure).
  const [todayKey] = React.useState(() => toDateKey(new Date()));

  // Resolve the active range, defaulting to the last 30 days when unset.
  const { from, to } = React.useMemo(() => {
    const toKey = insightsDateTo ?? todayKey;
    const fromKey = insightsDateFrom ?? shiftDayKey(todayKey, -29);
    return { from: fromKey <= toKey ? fromKey : toKey, to: toKey };
  }, [insightsDateFrom, insightsDateTo, todayKey]);

  const range: InsightsRange = React.useMemo(
    () => ({ from, to, days: daysBetween(from, todayKey) }),
    [from, to, todayKey]
  );

  const calendarValue: DateRange = React.useMemo(
    () => ({ from: keyToDate(from), to: keyToDate(to) }),
    [from, to]
  );

  const handleRangeChange = React.useCallback(
    (next: DateRange) => {
      if (!next.from) return;
      const fromKey = toDateKey(next.from);
      const toKey = next.to ? toDateKey(next.to) : fromKey;
      setInsightsDateRange(fromKey, toKey);
    },
    [setInsightsDateRange]
  );

  const { data: stats, loading: statsLoading } = useInsightsResource<ServicesStatsResponse>('/api/services/stats');

  const showLibrary = canMovies || canSeries || canMusic;
  // Library gaps spans both libraries, so the endpoint requires read access to both.
  const canGaps = canSeries && canMovies;

  return (
    <div className="flex flex-col min-h-0 animate-content-in">
      <div
        className="sticky z-30 px-2 pb-3 pt-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex items-center justify-between gap-3"
        style={{ top: 'var(--header-height, 0px)' }}
      >
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight">Insights</h1>
          <p className="text-[11px] text-muted-foreground">Trends across your library, downloads & viewing</p>
        </div>
        <div className="w-40 shrink-0">
          <DateRangeSelect value={calendarValue} onChange={handleRangeChange} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-6 space-y-5">
        <ServiceHealthStrip />
        <KpiRow stats={stats} loading={statsLoading} />
        {showLibrary && <LibraryGrowthCard range={range} />}
        {canGaps && <LibraryGapsCard />}
        {showLibrary && <DownloadSuccessCard range={range} />}
        {showLibrary && <DownloadPipelineCard range={range} />}
        {showLibrary && <StorageInsightsCard />}
        {canTorrents && <SeedingEconomicsCard />}
        {canProwlarr && <TopIndexersCard range={range} />}
        {canJellyfin && <JellyfinLibrariesCard />}
        {canWatchStats && <WatchStatsSection range={range} />}
      </div>
    </div>
  );
}
