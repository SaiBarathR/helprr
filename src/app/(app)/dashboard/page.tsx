'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Film, Tv, Download, HardDrive, Clock, ArrowRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { QueueItem, CalendarEvent } from '@/types';

interface DashboardStats {
  totalMovies: number;
  totalSeries: number;
  activeDownloads: number;
  diskSpace: { freeSpace: number; totalSpace: number }[];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [upcoming, setUpcoming] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const [statsRes, queueRes, calendarRes] = await Promise.allSettled([
          fetch('/api/services/stats'),
          fetch('/api/activity/queue'),
          fetch('/api/calendar?days=7'),
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
      } catch {
        // Services may not be configured yet
      } finally {
        setLoading(false);
      }
    }

    fetchDashboard();
    const interval = setInterval(fetchDashboard, 5000);
    return () => clearInterval(interval);
  }, []);

  function formatBytes(bytes: number) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
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
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

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
                <div key={event.id} className="flex items-center gap-3 px-4 py-3">
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
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
