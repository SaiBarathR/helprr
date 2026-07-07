'use client';

import * as React from 'react';
import type { DateRange } from 'react-day-picker';
import { Library, Download, HardDrive, MonitorPlay, ScanSearch, type LucideIcon } from 'lucide-react';
import { useUIStore } from '@/lib/store';
import { useCan } from '@/components/permission-provider';
import { DateRangeSelect } from '@/components/widgets/widget-filter-controls';
import { useInsightsResource, toDateKey, type InsightsRange } from '@/components/insights/insights-shared';
import { shiftDayKey } from '@/lib/insights';
import { KpiRow } from '@/components/insights/kpi-row';
import { ServiceHealthStrip } from '@/components/insights/service-health-strip';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { LibraryGapsCard } from '@/components/insights/library-gaps-card';
import { StorageInsightsCard } from '@/components/insights/storage-insights-card';
import { SeedingEconomicsCard } from '@/components/insights/seeding-economics-card';

// These four cards pull in recharts (heavy); load them on demand (client-only)
// so the chart lib stays out of the insights page's initial chunk.
const chartCardSkeleton = () => <Skeleton className="h-64 w-full rounded-xl" />;
const LibraryGrowthCard = dynamic(
  () => import('@/components/insights/library-growth-card').then((m) => m.LibraryGrowthCard),
  { ssr: false, loading: chartCardSkeleton },
);
const DownloadSuccessCard = dynamic(
  () => import('@/components/insights/download-success-card').then((m) => m.DownloadSuccessCard),
  { ssr: false, loading: chartCardSkeleton },
);
const DownloadPipelineCard = dynamic(
  () => import('@/components/insights/download-pipeline-card').then((m) => m.DownloadPipelineCard),
  { ssr: false, loading: chartCardSkeleton },
);
const TopIndexersCard = dynamic(
  () => import('@/components/insights/top-indexers-card').then((m) => m.TopIndexersCard),
  { ssr: false, loading: chartCardSkeleton },
);
import { WatchStatsSection } from '@/components/insights/watch-stats-section';
import { JellyfinLibrariesCard } from '@/components/insights/jellyfin-libraries-card';
import { TechnicalBreakdownCard, type MediaAnalysisKindFilter } from '@/components/insights/technical-breakdown-card';
import { QualityScoreCard } from '@/components/insights/quality-score-card';
import { FileExplorerCard } from '@/components/insights/file-explorer-card';
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

type InsightsTabId = 'library' | 'downloads' | 'storage' | 'analysis' | 'watching';

const TAB_META: Record<InsightsTabId, { label: string; icon: LucideIcon }> = {
  library: { label: 'Library', icon: Library },
  downloads: { label: 'Downloads', icon: Download },
  storage: { label: 'Storage', icon: HardDrive },
  analysis: { label: 'Analysis', icon: ScanSearch },
  watching: { label: 'Watching', icon: MonitorPlay },
};

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

  // Only tabs with at least one permitted card are offered.
  const tabs = React.useMemo(() => {
    const list: InsightsTabId[] = [];
    if (showLibrary || canGaps || canJellyfin) list.push('library');
    if (showLibrary || canProwlarr) list.push('downloads');
    if (showLibrary || canTorrents) list.push('storage');
    // Media analysis reads *arr file metadata, so it needs at least one video library.
    if (canMovies || canSeries) list.push('analysis');
    if (canWatchStats) list.push('watching');
    return list;
  }, [showLibrary, canGaps, canJellyfin, canProwlarr, canTorrents, canWatchStats, canMovies, canSeries]);

  const [tab, setTab] = React.useState<InsightsTabId>('library');
  // Movies/Episodes scope for the Analysis tab — shared by all three cards so
  // the two aggregate cards dedupe onto one request.
  const [analysisKind, setAnalysisKind] = React.useState<MediaAnalysisKindFilter>('all');
  // Permissions load async — fall back to the first offered tab until the
  // chosen one (or any) is available.
  const activeTab = tabs.includes(tab) ? tab : tabs[0];

  return (
    <div className="flex flex-col min-h-0 animate-content-in">
      <div
        className="page-toolbar page-toolbar-flush pb-3 app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex items-center justify-between gap-3"
      >
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight">Insights</h1>
          <p className="text-[11px] text-muted-foreground">Trends across your library, downloads & viewing</p>
        </div>
        <div className="w-40 shrink-0">
          <DateRangeSelect value={calendarValue} onChange={handleRangeChange} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pt-3 pb-6 space-y-4">
        {tabs.length > 1 && (
          <div role="tablist" className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-2 px-2">
            {tabs.map((id) => {
              const meta = TAB_META[id];
              const Icon = meta.icon;
              const active = id === activeTab;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  onClick={() => setTab(id)}
                  aria-selected={active}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5 transition-colors ${
                    active
                      ? 'bg-primary/20 text-primary border border-primary/40'
                      : 'bg-accent/40 text-muted-foreground border border-transparent hover:text-foreground'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {meta.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Health + KPIs live in the Library tab; when that tab isn't permitted
            (or no tab is), surface them standalone so they're never lost. */}
        {!tabs.includes('library') && (
          <div className="space-y-4">
            <ServiceHealthStrip />
            <KpiRow stats={stats} loading={statsLoading} />
          </div>
        )}
        {activeTab === 'library' && (
          <div className="space-y-4 animate-content-in">
            <ServiceHealthStrip />
            <KpiRow stats={stats} loading={statsLoading} />
            {showLibrary && <LibraryGrowthCard range={range} />}
            {canGaps && <LibraryGapsCard />}
            {canJellyfin && <JellyfinLibrariesCard />}
          </div>
        )}
        {activeTab === 'downloads' && (
          <div className="space-y-4 animate-content-in">
            {showLibrary && <DownloadSuccessCard range={range} />}
            {showLibrary && <DownloadPipelineCard range={range} />}
            {canProwlarr && <TopIndexersCard range={range} />}
          </div>
        )}
        {activeTab === 'storage' && (
          <div className="space-y-4 animate-content-in">
            {showLibrary && <StorageInsightsCard />}
            {canTorrents && <SeedingEconomicsCard />}
          </div>
        )}
        {activeTab === 'analysis' && (
          <div className="space-y-4 animate-content-in">
            <TechnicalBreakdownCard kind={analysisKind} onKindChange={setAnalysisKind} canMovies={canMovies} canSeries={canSeries} />
            <QualityScoreCard kind={analysisKind} />
            <FileExplorerCard kind={analysisKind} />
          </div>
        )}
        {activeTab === 'watching' && (
          <div className="space-y-4 animate-content-in">
            <WatchStatsSection range={range} />
          </div>
        )}
      </div>
    </div>
  );
}
