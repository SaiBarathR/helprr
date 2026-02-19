'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Film, Tv, Download, HardDrive, Clock, ArrowRight, Layers } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { QueueItem, CalendarEvent } from '@/types';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';

interface DashboardStats {
  totalMovies: number;
  totalSeries: number;
  activeDownloads: number;
  diskSpace: { freeSpace: number; totalSpace: number }[];
}

interface ProwlarrSummary {
  total: number;
  enabled: number;
  disabled: number;
  blocked: number;
}

/**
 * Render the dashboard page showing system stats, active downloads, upcoming calendar events, and Prowlarr indexer summary.
 *
 * The component fetches dashboard data and updates periodically using the configured refresh interval.
 *
 * @returns The JSX element for the dashboard page.
 */
export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [upcoming, setUpcoming] = useState<CalendarEvent[]>([]);
  const [prowlarr, setProwlarr] = useState<ProwlarrSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);

  const fetchDashboard = useCallback(async () => {
    try {
      const [statsRes, queueRes, calendarRes, indexersRes, statusRes] = await Promise.allSettled([
        fetch('/api/services/stats'),
        fetch('/api/activity/queue'),
        fetch('/api/calendar?days=7'),
        fetch('/api/prowlarr/indexers'),
        fetch('/api/prowlarr/status'),
      ]);

      if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
        setStats(await statsRes.value.json());
      }
      if (queueRes.status === 'fulfilled' && queueRes.value.ok) {
        const data = await queueRes.value.json();
        setQueue(data.records || []);
      }
      if (calendarRes.status === 'fulfilled' && calendarRes.value.ok) {
        setUpcoming(await calendarRes.value.json());
      }
      if (indexersRes.status === 'fulfilled' && indexersRes.value.ok) {
        const indexers: { id: number; enable: boolean }[] = await indexersRes.value.json();
        if (Array.isArray(indexers)) {
          const statuses: { providerId: number; disabledTill?: string }[] =
            statusRes.status === 'fulfilled' && statusRes.value.ok
              ? await statusRes.value.json()
              : [];
          const blockedIds = new Set(statuses.filter((s) => s.disabledTill).map((s) => s.providerId));
          const enabled = indexers.filter((i) => i.enable).length;
          const blocked = indexers.filter((i) => blockedIds.has(i.id)).length;
          setProwlarr({ total: indexers.length, enabled, disabled: indexers.length - enabled, blocked });
        }
      }
    } catch {
      // Services may not be configured yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadRefreshInterval() {
      const intervalMs = await getRefreshIntervalMs('dashboardRefreshIntervalSecs', 5);
      setRefreshIntervalMs(intervalMs);
    }
    loadRefreshInterval();
  }, []);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [fetchDashboard, refreshIntervalMs]);

  function formatBytes(bytes: number) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  if (loading) {
    return (
      <div className="space-y-6 pt-2">
        {/* <h1 className="text-2xl font-bold">Dashboard</h1> */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl bg-card p-4">
              <Skeleton className="h-8 w-20 mb-2" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-2">
      {/* <h1 className="text-2xl font-bold">Dashboard</h1> */}

      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-card p-4 flex items-center gap-3">
          <div className="rounded-lg bg-blue-500/10 p-2.5">
            <Film className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <p className="text-2xl font-bold">{stats?.totalMovies ?? '--'}</p>
            <p className="text-xs text-muted-foreground">Movies</p>
          </div>
        </div>
        <div className="rounded-xl bg-card p-4 flex items-center gap-3">
          <div className="rounded-lg bg-purple-500/10 p-2.5">
            <Tv className="h-5 w-5 text-purple-500" />
          </div>
          <div>
            <p className="text-2xl font-bold">{stats?.totalSeries ?? '--'}</p>
            <p className="text-xs text-muted-foreground">TV Series</p>
          </div>
        </div>
        <div className="rounded-xl bg-card p-4 flex items-center gap-3">
          <div className="rounded-lg bg-green-500/10 p-2.5">
            <Download className="h-5 w-5 text-green-500" />
          </div>
          <div>
            <p className="text-2xl font-bold">{stats?.activeDownloads ?? '--'}</p>
            <p className="text-xs text-muted-foreground">Downloading</p>
          </div>
        </div>
        <div className="rounded-xl bg-card p-4 flex items-center gap-3">
          <div className="rounded-lg bg-orange-500/10 p-2.5">
            <HardDrive className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <p className="text-2xl font-bold">
              {stats?.diskSpace && stats.diskSpace.length > 0
                ? formatBytes(
                  stats.diskSpace.reduce((acc, disk) => acc + disk.freeSpace, 0)
                )
                : '--'}
            </p>
            <p className="text-xs text-muted-foreground">Free Space</p>
          </div>
        </div>
      </div>

      {/* Prowlarr Indexers */}
      {prowlarr && (
        <Link
          href="/prowlarr"
          className="rounded-xl bg-card p-4 flex items-center gap-4 hover:bg-muted/30 active:bg-muted/50 transition-colors"
        >
          <div className="rounded-lg bg-violet-500/10 p-2.5 shrink-0">
            <Layers className="h-5 w-5 text-violet-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground mb-1">Prowlarr Indexers</p>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-2xl font-bold tabular-nums">{prowlarr.total}</span>
              <div className="flex items-center gap-2 text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                  <span className="text-muted-foreground">{prowlarr.enabled} enabled</span>
                </span>
                {prowlarr.disabled > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    <span className="text-muted-foreground">{prowlarr.disabled} disabled</span>
                  </span>
                )}
                {prowlarr.blocked > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                    <span className="text-rose-400">{prowlarr.blocked} blocked</span>
                  </span>
                )}
              </div>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </Link>
      )}

      {/* Active Downloads */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Active Downloads</h2>
          <Link href="/activity" className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="rounded-xl bg-card overflow-hidden">
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No active downloads</p>
          ) : (
            <div className="divide-y divide-border/50">
              {queue.slice(0, 5).map((item) => {
                const progress = item.size > 0 ? ((item.size - item.sizeleft) / item.size) * 100 : 0;
                return (
                  <div key={item.id} className="px-4 py-3 space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="truncate flex-1 mr-2 font-medium">{item.title}</span>
                      <span className="text-muted-foreground text-xs shrink-0">
                        {progress.toFixed(0)}%
                      </span>
                    </div>
                    <Progress value={progress} className="h-1" />
                    {item.timeleft && (
                      <p className="text-[11px] text-muted-foreground">{item.timeleft} remaining</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Upcoming */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Upcoming (7 Days)</h2>
          <Link href="/calendar" className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="rounded-xl bg-card overflow-hidden">
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Nothing upcoming</p>
          ) : (
            <div className="divide-y divide-border/50">
              {upcoming.slice(0, 8).map((event) => (
                <Link
                  key={event.id}
                  href={event.type === 'episode' ? `/series/${event.seriesId}` : `/movies/${event.movieId}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 active:bg-muted/50 transition-colors"
                >
                  <Badge
                    variant="secondary"
                    className={event.type === 'episode' ? 'bg-blue-500/10 text-blue-500' : 'bg-orange-500/10 text-orange-500'}
                  >
                    {event.type === 'episode' ? <Tv className="h-3 w-3" /> : <Film className="h-3 w-3" />}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate font-medium">{event.title}</p>
                    <p className="text-[11px] text-muted-foreground">{event.subtitle}</p>
                  </div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1 shrink-0">
                    <Clock className="h-3 w-3" />
                    {formatDistanceToNow(new Date(event.date), { addSuffix: true })}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}