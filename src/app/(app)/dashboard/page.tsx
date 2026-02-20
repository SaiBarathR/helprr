'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Film,
  Tv,
  Download,
  HardDrive,
  Clock,
  ArrowRight,
  Layers,
  MonitorPlay,
  Play,
  Pause,
  Zap,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { QueueItem, CalendarEvent, MediaImage } from '@/types';
import type { JellyfinSession, JellyfinItem } from '@/types/jellyfin';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';
import { isProtectedApiImageSrc } from '@/lib/image';

interface DashboardStats {
  totalMovies: number;
  totalSeries: number;
  activeDownloads: number;
  diskSpace: { freeSpace: number; totalSpace: number }[];
  jellyfin?: {
    movieCount: number;
    seriesCount: number;
    episodeCount: number;
    activeStreams: number;
  };
}

interface ProwlarrSummary {
  total: number;
  enabled: number;
  disabled: number;
  blocked: number;
}

interface RecentItem {
  id: string;
  title: string;
  subtitle: string;
  type: 'movie' | 'episode';
  date: string;
  poster: string | null;
  href: string;
}

function ticksToMinutes(ticks: number): string {
  const totalMinutes = Math.floor(ticks / 600000000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function ticksToProgress(position: number, runtime: number): number {
  if (!runtime || runtime === 0) return 0;
  return Math.min(100, (position / runtime) * 100);
}

function getSessionTitle(item: JellyfinItem): string {
  if (item.Type === 'Episode' && item.SeriesName) {
    const s = item.ParentIndexNumber != null ? `S${item.ParentIndexNumber}` : '';
    const e = item.IndexNumber != null ? `E${item.IndexNumber}` : '';
    return `${item.SeriesName} ${s}${e}`;
  }
  return item.Name;
}

function getPoster(images: MediaImage[]): string | null {
  const img = images.find((i) => i.coverType === 'poster');
  return img?.remoteUrl || img?.url || null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return `-${formatBytes(Math.abs(bytes))}`;
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDistanceToNowSafe(input: string, fallback = 'unknown'): string {
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return fallback;
  return formatDistanceToNow(date, { addSuffix: true });
}

/* ─── Carousel wrapper with fade edge hint ─── */
function Carousel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="relative">
      <div className={`flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide -mx-1 px-1 ${className}`}>
        {children}
      </div>
      {/* Right fade edge — signals more content */}
      <div className="pointer-events-none absolute top-0 right-0 bottom-2 w-8 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}

/* ─── Section header ─── */
function SectionHeader({ title, href, linkText = 'View all', badge }: { title: string; href?: string; linkText?: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {badge}
      </div>
      {href && (
        <Link href={href} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5">
          {linkText} <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [upcoming, setUpcoming] = useState<CalendarEvent[]>([]);
  const [prowlarr, setProwlarr] = useState<ProwlarrSummary | null>(null);
  const [sessions, setSessions] = useState<JellyfinSession[]>([]);
  const [resumeItems, setResumeItems] = useState<JellyfinItem[]>([]);
  const [recentlyAdded, setRecentlyAdded] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);

  const fetchDashboard = useCallback(async () => {
    try {
      const [statsRes, queueRes, calendarRes, indexersRes, statusRes, sessionsRes, resumeRes, recentRes] = await Promise.allSettled([
        fetch('/api/services/stats'),
        fetch('/api/activity/queue'),
        fetch('/api/calendar?days=7'),
        fetch('/api/prowlarr/indexers'),
        fetch('/api/prowlarr/status'),
        fetch('/api/jellyfin/sessions'),
        fetch('/api/jellyfin/resume'),
        fetch('/api/activity/recent?limit=15'),
      ]);

      if (statsRes.status === 'fulfilled' && statsRes.value.ok) setStats(await statsRes.value.json());
      if (queueRes.status === 'fulfilled' && queueRes.value.ok) {
        const data = await queueRes.value.json();
        setQueue(data.records || []);
      }
      if (calendarRes.status === 'fulfilled' && calendarRes.value.ok) setUpcoming(await calendarRes.value.json());
      if (indexersRes.status === 'fulfilled' && indexersRes.value.ok) {
        const indexers: { id: number; enable: boolean }[] = await indexersRes.value.json();
        if (Array.isArray(indexers)) {
          const statuses: { providerId: number; disabledTill?: string }[] =
            statusRes.status === 'fulfilled' && statusRes.value.ok ? await statusRes.value.json() : [];
          const blockedIds = new Set(statuses.filter((s) => s.disabledTill).map((s) => s.providerId));
          const enabled = indexers.filter((i) => i.enable).length;
          const blocked = indexers.filter((i) => blockedIds.has(i.id)).length;
          setProwlarr({ total: indexers.length, enabled, disabled: indexers.length - enabled, blocked });
        }
      }
      if (sessionsRes.status === 'fulfilled' && sessionsRes.value.ok) {
        const data = await sessionsRes.value.json();
        setSessions(data.sessions || []);
      }
      if (resumeRes.status === 'fulfilled' && resumeRes.value.ok) {
        const data = await resumeRes.value.json();
        setResumeItems(data.items || []);
      }
      if (recentRes.status === 'fulfilled' && recentRes.value.ok) {
        const data = await recentRes.value.json();
        if (Array.isArray(data)) setRecentlyAdded(data);
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

  if (loading) {
    return (
      <div className="space-y-5 pt-2">
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl bg-card p-4">
              <Skeleton className="h-8 w-20 mb-2" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
        <div className="flex gap-3 overflow-hidden">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-[170px] w-[120px] rounded-xl shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pt-2">

      {/* ─── Stats Grid ─── */}
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
            <div className='flex gap-2 items-center'>
              <p className="text-2xl font-bold">{stats?.totalSeries ?? '--'}</p>
              <p className="text-xl">TV</p>
            </div>
            {stats?.jellyfin?.episodeCount !== undefined && (
              <p className="text-xs text-muted-foreground">{stats.jellyfin.episodeCount} episodes</p>
            )}
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
                ? formatBytes(stats.diskSpace.reduce((acc, disk) => acc + disk.freeSpace, 0))
                : '--'}
            </p>
            <p className="text-xs text-muted-foreground">Free Space</p>
          </div>
        </div>
      </div>

      {/* ─── Prowlarr Indexers ─── */}
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
                  <span className="text-muted-foreground">{prowlarr.enabled} on</span>
                </span>
                {prowlarr.disabled > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    <span className="text-muted-foreground">{prowlarr.disabled} off</span>
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

      {/* ─── Now Streaming ─── */}
      {sessions.length > 0 && (
        <div>
          <SectionHeader
            title="Now Streaming"
            badge={
              <span className="flex items-center gap-1.5 text-xs">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                <span className="text-green-400 tabular-nums">{sessions.length}</span>
              </span>
            }
          />
          <Carousel>
            {sessions.map((session) => {
              const item = session.NowPlayingItem;
              const playState = session.PlayState;
              const progress = item?.RunTimeTicks && playState?.PositionTicks
                ? ticksToProgress(playState.PositionTicks, item.RunTimeTicks)
                : 0;
              const transcodingInfo = session.TranscodingInfo;
              const isTranscoding = Boolean(transcodingInfo && !transcodingInfo.IsVideoDirect);
              const isHardwareTranscoding = Boolean(transcodingInfo?.HardwareAccelerationType?.trim());
              const imageId = item?.Type === 'Episode' && item?.SeriesId ? item.SeriesId : item?.Id;
              const jellyfinBackdropSrc = item?.Id
                ? `/api/jellyfin/image?itemId=${item.Type === 'Episode' && item.SeriesId ? item.SeriesId : item.Id}&type=Backdrop&maxWidth=520&quality=80`
                : '';
              const jellyfinPrimarySrc = imageId
                ? `/api/jellyfin/image?itemId=${imageId}&type=Primary&maxWidth=520&quality=80`
                : '';
              const watchHref = item?.Id ? `/watch?itemId=${encodeURIComponent(item.Id)}` : null;

              return (
                <div
                  key={session.Id}
                  className="snap-start shrink-0 w-[260px] rounded-xl bg-card overflow-hidden"
                >
                  {/* Backdrop area */}
                  <div className="relative h-20 bg-muted overflow-hidden">
                    {item?.BackdropImageTags?.[0] && item.Id ? (
                      <Image
                        src={jellyfinBackdropSrc}
                        alt=""
                        fill
                        sizes="260px"
                        className="object-cover"
                        unoptimized={isProtectedApiImageSrc(jellyfinBackdropSrc)}
                      />
                    ) : imageId && item?.ImageTags?.Primary ? (
                      <Image
                        src={jellyfinPrimarySrc}
                        alt=""
                        fill
                        sizes="260px"
                        className="object-cover blur-sm scale-110"
                        unoptimized={isProtectedApiImageSrc(jellyfinPrimarySrc)}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
                        <MonitorPlay className="h-6 w-6 text-muted-foreground/20" />
                      </div>
                    )}
                    {/* Gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-card/60 to-transparent" />
                    {/* Play state + title overlaid */}
                    <div className="absolute bottom-0 left-0 right-0 px-3 pb-1.5">
                      <div className="flex items-center gap-1.5">
                        {playState?.IsPaused
                          ? <Pause className="h-3 w-3 text-amber-400 shrink-0" />
                          : <Play className="h-3 w-3 text-green-400 shrink-0" />
                        }
                        <span className="text-[13px] font-semibold truncate text-foreground">
                          {item ? getSessionTitle(item) : 'Unknown'}
                        </span>
                      </div>
                    </div>
                  </div>
                  {/* Bottom detail strip */}
                  <div className="px-3 pt-1 pb-2.5 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="truncate">{session.UserName} &middot; {session.DeviceName}</span>
                      {isTranscoding ? (
                        <Badge
                          variant="outline"
                          className={`text-[9px] px-1 py-0 h-3.5 shrink-0 ml-2 ${isHardwareTranscoding ? 'text-amber-500 border-amber-500/30' : 'text-orange-500 border-orange-500/30'}`}
                        >
                          <Zap className="h-2 w-2 mr-0.5" />
                          {isHardwareTranscoding ? 'HW' : 'Transcode'}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 text-green-500 border-green-500/30 shrink-0 ml-2">
                          Direct
                        </Badge>
                      )}
                    </div>
                    {watchHref && (
                      <Link
                        href={watchHref}
                        className="inline-flex text-[10px] text-primary font-medium"
                      >
                        Watch in Helprr
                      </Link>
                    )}
                    {item?.RunTimeTicks && (
                      <div className="flex items-center gap-2">
                        <Progress value={progress} className="h-[3px] flex-1" />
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                          {playState?.PositionTicks ? ticksToMinutes(playState.PositionTicks) : '0m'}/{ticksToMinutes(item.RunTimeTicks)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </Carousel>
        </div>
      )}

      {/* ─── Continue Watching ─── */}
      {resumeItems.length > 0 && (
        <div>
          <SectionHeader title="Continue Watching" />
          <Carousel>
            {resumeItems.map((item) => {
              const progress = item.UserData?.PlayedPercentage ?? 0;
              const imageId = item.Type === 'Episode' && item.SeriesId ? item.SeriesId : item.Id;
              const hasImage = item.ImageTags?.Primary || (item.Type === 'Episode' && item.SeriesId);
              const jellyfinPosterSrc = `/api/jellyfin/image?itemId=${imageId}&type=Primary&maxWidth=220&quality=90`;
              const watchHref = `/watch?itemId=${encodeURIComponent(item.Id)}`;

              return (
                <Link key={item.Id} href={watchHref} className="snap-start shrink-0 w-[110px]">
                  <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted mb-1.5 shadow-sm">
                    {hasImage ? (
                      <Image
                        src={jellyfinPosterSrc}
                        alt={item.Name}
                        fill
                        sizes="110px"
                        className="object-cover"
                        unoptimized={isProtectedApiImageSrc(jellyfinPosterSrc)}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <MonitorPlay className="h-6 w-6 text-muted-foreground/20" />
                      </div>
                    )}
                    {/* Progress bar at bottom of poster */}
                    <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10">
                      <div className="h-full bg-[#00a4dc]" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  <p className="text-[11px] font-medium truncate leading-tight">{item.SeriesName || item.Name}</p>
                  {item.Type === 'Episode' && item.ParentIndexNumber != null && (
                    <p className="text-[10px] text-muted-foreground truncate">
                      S{item.ParentIndexNumber}E{item.IndexNumber}
                    </p>
                  )}
                </Link>
              );
            })}
          </Carousel>
        </div>
      )}

      {/* ─── Active Downloads ─── */}
      {queue.length > 0 && (
        <div>
          <SectionHeader title="Downloading" href="/activity" />
          <Carousel>
            {queue.slice(0, 8).map((item) => {
              const progress = item.size > 0 ? ((item.size - item.sizeleft) / item.size) * 100 : 0;
              return (
                <div
                  key={item.id}
                  className="snap-start shrink-0 w-[200px] rounded-xl bg-card p-3 flex flex-col justify-between"
                >
                  <div>
                    <p className="text-[12px] font-medium line-clamp-2 leading-snug mb-2">{item.title}</p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[20px] font-bold tabular-nums text-green-400">{progress.toFixed(0)}%</span>
                      {item.timeleft && (
                        <span className="text-[10px] text-muted-foreground">{item.timeleft}</span>
                      )}
                    </div>
                    <Progress value={progress} className="h-1" />
                  </div>
                </div>
              );
            })}
          </Carousel>
        </div>
      )}

      {/* ─── Recently Added ─── */}
      {recentlyAdded.length > 0 && (
        <div>
          <SectionHeader title="Recently Added" href="/activity/history" />
          <Carousel>
            {recentlyAdded.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="snap-start shrink-0 w-[110px] group"
              >
                <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted mb-1.5 shadow-sm">
                  {item.poster ? (
                    <Image
                      src={item.poster}
                      alt={item.title}
                      fill
                      sizes="110px"
                      className="object-cover transition-transform duration-300 group-active:scale-105"
                      unoptimized={isProtectedApiImageSrc(item.poster)}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      {item.type === 'movie'
                        ? <Film className="h-6 w-6 text-muted-foreground/20" />
                        : <Tv className="h-6 w-6 text-muted-foreground/20" />
                      }
                    </div>
                  )}
                  {/* Type badge in corner */}
                  <div className="absolute top-1.5 left-1.5">
                    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md ${item.type === 'movie' ? 'bg-blue-500/80' : 'bg-purple-500/80'}`}>
                      {item.type === 'movie' ? <Film className="h-2.5 w-2.5 text-white" /> : <Tv className="h-2.5 w-2.5 text-white" />}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] font-medium truncate leading-tight">{item.title}</p>
                <p className="text-[10px] text-muted-foreground truncate">{item.subtitle || formatDistanceToNowSafe(item.date)}</p>
              </Link>
            ))}
          </Carousel>
        </div>
      )}

      {/* ─── Upcoming ─── */}
      <div>
        <SectionHeader title="Upcoming" href="/calendar" />
        {upcoming.length === 0 ? (
          <div className="rounded-xl bg-card py-8 text-center">
            <p className="text-sm text-muted-foreground">Nothing upcoming</p>
          </div>
        ) : (
          <Carousel>
            {upcoming.slice(0, 12).map((event) => {
              const poster = getPoster(event.images);
              return (
                <Link
                  key={event.id}
                  href={event.type === 'episode' ? `/series/${event.seriesId}` : `/movies/${event.movieId}`}
                  className="snap-start shrink-0 w-[110px] group"
                >
                  <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted mb-1.5 shadow-sm">
                    {poster ? (
                      <Image
                        src={poster}
                        alt={event.title}
                        fill
                        sizes="110px"
                        className="object-cover transition-transform duration-300 group-active:scale-105"
                        unoptimized={isProtectedApiImageSrc(poster)}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        {event.type === 'episode'
                          ? <Tv className="h-6 w-6 text-muted-foreground/20" />
                          : <Film className="h-6 w-6 text-muted-foreground/20" />
                        }
                      </div>
                    )}
                    {/* Time badge */}
                    <div className="absolute bottom-1.5 left-1.5 right-1.5">
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-sm text-[9px] text-white/90">
                        <Clock className="h-2 w-2" />
                        {formatDistanceToNowSafe(event.date)}
                      </span>
                    </div>
                    {/* Type badge */}
                    <div className="absolute top-1.5 left-1.5">
                      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md ${event.type === 'episode' ? 'bg-purple-500/80' : 'bg-blue-500/80'}`}>
                        {event.type === 'episode' ? <Tv className="h-2.5 w-2.5 text-white" /> : <Film className="h-2.5 w-2.5 text-white" />}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] font-medium truncate leading-tight">{event.title}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{event.subtitle}</p>
                </Link>
              );
            })}
          </Carousel>
        )}
      </div>
    </div>
  );
}
