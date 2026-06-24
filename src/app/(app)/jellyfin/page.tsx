'use client';

import { useCallback, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { FadeInImage } from '@/components/media/fade-in-image';
import Image from 'next/image';
import { PageSpinner } from '@/components/ui/page-spinner';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useRefreshAction } from '@/lib/hooks/use-refresh-action';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import type { DateRange } from 'react-day-picker';
import {
  Film,
  Tv,
  MonitorPlay,
  RefreshCw,
  Loader2,
  Server,
  Users,
  Clock,
  Library,
  AlertCircle,
  CheckCircle2,
  Clapperboard,
  CalendarIcon,
  ArrowUpDown,
  ChevronDown,
  Timer,
  XCircle,
  ChevronRight,
  Play,
  Square,
  RotateCw,
  Power,
  FolderSync,
} from 'lucide-react';
import type {
  JellyfinSession,
  JellyfinItem,
  JellyfinSystemInfo,
  JellyfinLibrary,
  JellyfinItemCounts,
  JellyfinDevice,
  JellyfinActivityEntry,
  JellyfinUser,
  JellyfinScheduledTask,
  PlaybackUserActivity,
  PlaybackBreakdownEntry,
  PlayActivityUser,
  CustomHistoryItem,
} from '@/types/jellyfin';
import { toast } from 'sonner';
import { ticksToMinutes, formatDurationSeconds, formatTriggerSchedule, timeAgo, taskRunDuration } from '@/lib/jellyfin-helpers';
import { isProtectedApiImageSrc } from '@/lib/image';
import { SessionCard } from '@/components/jellyfin/session-card';
import { StreamInfoDrawer } from '@/components/jellyfin/stream-info-drawer';
import { DeviceItem, DevicesSeeAllDrawer } from '@/components/jellyfin/device-item';
import { ActivityItem, ActivitySeeAllDrawer } from '@/components/jellyfin/activity-item';
import { ViewModeToggle } from '@/components/widgets/bento-primitives';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useExternalUrls } from '@/lib/hooks/use-external-urls';
import { useCan } from '@/components/permission-provider';

type JellyfinServerAction = 'restart' | 'shutdown' | 'scan-libraries';

const SERVER_ACTION_LABELS: Record<JellyfinServerAction, string> = {
  restart: 'restart the Jellyfin server',
  shutdown: 'shut down the Jellyfin server',
  'scan-libraries': 'scan all libraries',
};

// ─── Helpers ───

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayStr(): string {
  return toDateStr(new Date());
}

function formatDateCreated(dateStr: string): string {
  // DateCreated is UTC e.g. "2026-02-20 19:11:07.0338097"
  try {
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date)
  } catch (error) {
    console.error("Failed to parse date:", error);
    return dateStr;
  }
}

// ─── Types ───

type TabKey = 'overview' | 'users' | 'history' | 'stats';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'history', label: 'History' },
  { key: 'stats', label: 'Stats' },
];

const DAY_RANGES = [1, 3, 7, 14, 30, 90, 0]; // 0 = All Time
const MAX_DAYS = 18250;

// ─── Main Page ───

export default function JellyfinPage() {
  const pageQueryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('overview');
  // Users (sessions) and Stats are admin analytics; members keep Overview and
  // their own per-user History.
  const canSessions = useCan('jellyfin.sessions');
  const canStats = useCan('jellyfin.stats');
  const visibleTabs = useMemo(
    () =>
      TABS.filter((t) => {
        if (t.key === 'users') return canSessions;
        if (t.key === 'stats') return canStats;
        return true;
      }),
    [canSessions, canStats]
  );

  return (
    <div className="flex flex-col min-h-0 animate-content-in">
      <PullToRefresh onRefresh={() => pageQueryClient.invalidateQueries({ queryKey: ['jellyfin'] })} />
      <div className="sticky z-30 px-2 pb-3 pt-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80" style={{ top: 'var(--header-height, 0px)' }}>
        <div role="tablist" aria-label="Jellyfin sections" className="flex bg-muted/50 rounded-lg p-0.5 gap-0.5">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              id={`tab-${t.key}`}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              aria-controls={`panel-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1}
              onClick={() => setTab(t.key)}
              className={`flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors ${tab === t.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {tab === 'overview' && <OverviewTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'history' && <HistoryTab />}
          {tab === 'stats' && <StatsTab />}
        </div>
      </div>
    </div>
  );
}

// ─── Shared UI ───

function Carousel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="relative">
      <div className={`flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide -mx-1 px-1 ${className}`}>
        {children}
      </div>
      <div className="pointer-events-none absolute top-0 right-0 bottom-2 w-8 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}

function SectionHeader({ title, badge, trailing }: { title: string; badge?: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {badge}
      </div>
      {trailing}
    </div>
  );
}

function PluginNotice() {
  return (
    <div className="rounded-xl bg-muted/30 p-6 text-center">
      <AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
      <p className="text-sm font-medium text-muted-foreground">Playback Reporting Plugin not detected</p>
      <p className="text-xs text-muted-foreground/70 mt-1">Install the Jellyfin Playback Reporting Plugin for watch history and statistics.</p>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tab 1: OVERVIEW
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function OverviewTab() {
  const queryClient = useQueryClient();
  const [selectedSession, setSelectedSession] = useState<JellyfinSession | null>(null);
  const [serverAction, setServerAction] = useState<string | null>(null);
  const [pendingServerAction, setPendingServerAction] = useState<JellyfinServerAction | null>(null);
  const externalUrls = useExternalUrls();
  const jellyfinUrl = externalUrls.JELLYFIN;
  // Server info, scan/restart/shutdown, and scheduled tasks are admin-only —
  // members never see (or fetch) them.
  const canControl = useCan('jellyfin.control');

  // ── Always-on slices ──────────────────────────────────────────────
  // sessions + resume are the live data (who's watching / progress) — they poll
  // every 15s while the tab is focused (staleTime:0). counts/recently-added and
  // the other admin slices rarely change, so they hold a 60s staleTime — no
  // refetch on every mount/tab-return within that window.
  const sessionsQuery = useQuery({
    queryKey: ['jellyfin', 'sessions'],
    queryFn: jsonFetcher<{ sessions?: JellyfinSession[] }>('/api/jellyfin/sessions'),
    select: (d) => d.sessions ?? [],
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const resumeQuery = useQuery({
    queryKey: ['jellyfin', 'resume'],
    queryFn: jsonFetcher<{ items?: JellyfinItem[] }>('/api/jellyfin/resume'),
    select: (d) => d.items ?? [],
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const countsQuery = useQuery({
    queryKey: ['jellyfin', 'counts'],
    queryFn: jsonFetcher<{ counts?: JellyfinItemCounts }>('/api/jellyfin/counts'),
    select: (d) => d.counts ?? null,
    staleTime: 60_000,
  });
  const recentQuery = useQuery({
    queryKey: ['jellyfin', 'recently-added'],
    queryFn: jsonFetcher<{ items?: JellyfinItem[] }>('/api/jellyfin/recently-added?limit=20'),
    select: (d) => d.items ?? [],
    staleTime: 60_000,
  });

  // ── Admin slices (control-gated; never fetched for members) ───────
  const systemQuery = useQuery({
    queryKey: ['jellyfin', 'system'],
    queryFn: jsonFetcher<{ system?: JellyfinSystemInfo }>('/api/jellyfin/system'),
    select: (d) => d.system ?? null,
    staleTime: 60_000,
    enabled: canControl,
  });
  const tasksQuery = useQuery({
    queryKey: ['jellyfin', 'tasks'],
    queryFn: jsonFetcher<{ tasks?: JellyfinScheduledTask[] }>('/api/jellyfin/tasks'),
    staleTime: 0,
    enabled: canControl,
    // Keep scan/task progress live only while something is actually running —
    // otherwise the slice is mount-only (no idle polling).
    refetchInterval: (query) =>
      (query.state.data?.tasks ?? []).some((t) => t.State === 'Running' || t.State === 'Cancelling')
        ? 15_000
        : false,
    refetchIntervalInBackground: false,
  });
  const devicesQuery = useQuery({
    queryKey: ['jellyfin', 'devices'],
    queryFn: jsonFetcher<{ devices?: JellyfinDevice[]; selfDeviceId?: string }>('/api/jellyfin/devices'),
    staleTime: 60_000,
    enabled: canControl,
  });
  const activityQuery = useQuery({
    queryKey: ['jellyfin', 'activity', 'user'],
    queryFn: jsonFetcher<{ entries?: JellyfinActivityEntry[] }>('/api/jellyfin/activity?hasUserId=true&limit=20'),
    select: (d) => d.entries ?? [],
    staleTime: 60_000,
    enabled: canControl,
  });
  const alertsQuery = useQuery({
    queryKey: ['jellyfin', 'activity', 'no-user'],
    queryFn: jsonFetcher<{ entries?: JellyfinActivityEntry[] }>('/api/jellyfin/activity?hasUserId=false&limit=20'),
    select: (d) => d.entries ?? [],
    staleTime: 60_000,
    enabled: canControl,
  });

  const sessions = sessionsQuery.data ?? [];
  const resumeItems = resumeQuery.data ?? [];
  const counts = countsQuery.data ?? null;
  const recentlyAdded = recentQuery.data ?? [];
  const system = systemQuery.data ?? null;
  const tasks = useMemo(() => tasksQuery.data?.tasks ?? [], [tasksQuery.data]);
  const devices = devicesQuery.data?.devices ?? [];
  const selfDeviceId = devicesQuery.data?.selfDeviceId ?? '';
  const activity = activityQuery.data ?? [];
  const alerts = alertsQuery.data ?? [];

  const refreshDevices = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['jellyfin', 'devices'] }),
    [queryClient]
  );
  const refreshTasks = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['jellyfin', 'tasks'] }),
    [queryClient]
  );

  const runServerAction = useCallback(async (action: JellyfinServerAction) => {
    const label = SERVER_ACTION_LABELS[action];
    setServerAction(action);
    try {
      const res = await fetch('/api/jellyfin/system/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || `Failed to ${label}`);
        return;
      }
      if (action === 'scan-libraries') {
        await refreshTasks();
      }
    } catch {
      toast.error(`Failed to ${label}`);
    } finally {
      setServerAction(null);
    }
  }, [refreshTasks]);

  const handleServerAction = useCallback((action: JellyfinServerAction) => {
    if (action === 'scan-libraries') {
      void runServerAction(action);
      return;
    }
    setPendingServerAction(action);
  }, [runServerAction]);

  const scanRunning = useMemo(() => tasks.some((t) => t.Key === 'RefreshLibrary' && t.State === 'Running'), [tasks]);

  // First-paint spinner: gate only on the always-on slices (admin slices are
  // disabled for members and resolve independently). gcTime keeps data warm, so
  // switching back to this tab renders instantly while revalidating.
  if (
    (sessionsQuery.isLoading && !sessionsQuery.data)
    || (resumeQuery.isLoading && !resumeQuery.data)
    || (countsQuery.isLoading && !countsQuery.data)
    || (recentQuery.isLoading && !recentQuery.data)
  ) {
    return <PageSpinner />;
  }

  return (
    <div className="space-y-5">

      {sessions.length > 0 && (
        <div>
          <SectionHeader title="Active Sessions" badge={
            <span className="flex items-center gap-1.5 text-xs">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              <span className="text-green-400 tabular-nums">{sessions.length}</span>
            </span>
          } />
          <Carousel>{sessions.map((s) => <SessionCard key={s.Id} session={s} variant="full" onInfoClick={setSelectedSession} />)}</Carousel>
        </div>
      )}


      {canControl && system && (
        <div className="rounded-xl bg-card overflow-hidden">
          <div className="p-3 flex items-center gap-3">
            <div className="rounded-lg bg-[var(--hpr-cyan)]/10 p-2"><Server className="h-4 w-4 text-[var(--hpr-cyan)]" /></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{system.ServerName}</p>
              <p className="text-xs text-muted-foreground">v{system.Version}</p>
            </div>
            <div className="flex gap-1.5">
              {system.HasPendingRestart && <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-amber-500 border-amber-500/30">Restart needed</Badge>}
              {system.HasUpdateAvailable && <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-blue-500 border-blue-500/30">Update available</Badge>}
              {!system.HasPendingRestart && !system.HasUpdateAvailable && (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-green-500 border-green-500/30"><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />Healthy</Badge>
              )}
            </div>
          </div>
          <div className="border-t border-border/50 px-3 py-2 flex gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 flex-1 text-[11px] gap-1.5 text-muted-foreground hover:text-[var(--hpr-cyan)] hover:bg-[var(--hpr-cyan)]/10"
              disabled={serverAction !== null || scanRunning}
              onClick={() => handleServerAction('scan-libraries')}
            >
              {serverAction === 'scan-libraries' || scanRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderSync className="h-3 w-3" />}
              {scanRunning ? 'Scanning…' : 'Scan Libraries'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 flex-1 text-[11px] gap-1.5 text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"
              disabled={serverAction !== null}
              onClick={() => handleServerAction('restart')}
            >
              {serverAction === 'restart' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
              Restart
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 flex-1 text-[11px] gap-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
              disabled={serverAction !== null}
              onClick={() => handleServerAction('shutdown')}
            >
              {serverAction === 'shutdown' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
              Shutdown
            </Button>
          </div>
        </div>
      )}
      
      {canControl && tasks.length > 0 && <ScheduledTasksList tasks={tasks} onRefresh={refreshTasks} />}

      {counts && (
        <div className="grid gap-3 grid-cols-2">
          <StatCard icon={Film} color="blue" value={counts.MovieCount} label="Movies" />
          <StatCard icon={Tv} color="purple" value={counts.SeriesCount} label="Series" />
          <StatCard icon={Clapperboard} color="indigo" value={counts.EpisodeCount} label="Episodes" />
          <StatCard icon={MonitorPlay} color="green" value={sessions.length} label="Streams" />
        </div>
      )}

      {canControl && devices.length > 0 && (
        <DevicesSection devices={devices} selfDeviceId={selfDeviceId} onRefresh={refreshDevices} />
      )}

      {canControl && activity.length > 0 && (
        <ActivityFeed title="Activity" entries={activity} />
      )}

      {canControl && alerts.length > 0 && (
        <ActivityFeed title="Alerts" entries={alerts} alert />
      )}

      {resumeItems.length > 0 && (
        <div>
          <SectionHeader title="Continue Watching" />
          <Carousel>{resumeItems.map((item, i) => <PosterCard key={item.Id} item={item} showProgress jellyfinUrl={jellyfinUrl} imagePriority={i < 4} />)}</Carousel>
        </div>
      )}

      {recentlyAdded.length > 0 && (
        <div>
          <SectionHeader title="Recently Added" />
          <Carousel>{recentlyAdded.map((item, i) => <PosterCard key={item.Id} item={item} jellyfinUrl={jellyfinUrl} imagePriority={i < 4} />)}</Carousel>
        </div>
      )}

      <StreamInfoDrawer session={selectedSession} onClose={() => setSelectedSession(null)} />
      <ConfirmDialog
        open={pendingServerAction !== null}
        onOpenChange={(open) => { if (!open && serverAction === null) setPendingServerAction(null); }}
        title="Confirm action"
        description={pendingServerAction ? `Are you sure you want to ${SERVER_ACTION_LABELS[pendingServerAction]}?` : undefined}
        confirmLabel={pendingServerAction === 'shutdown' ? 'Shut down' : pendingServerAction === 'restart' ? 'Restart' : 'Confirm'}
        destructive
        busy={serverAction !== null}
        onConfirm={async () => {
          if (!pendingServerAction) return;
          await runServerAction(pendingServerAction);
          setPendingServerAction(null);
        }}
      />
    </div>
  );
}

function PosterCard({ item, showProgress, jellyfinUrl, imagePriority }: { item: JellyfinItem; showProgress?: boolean; jellyfinUrl?: string; imagePriority?: boolean }) {
  const progress = item.UserData?.PlayedPercentage ?? 0;
  const imageId = item.Type === 'Episode' && item.SeriesId ? item.SeriesId : item.Id;
  const hasImage = item.ImageTags?.Primary || (item.Type === 'Episode' && item.SeriesId);
  const posterSrc = `/api/jellyfin/image?itemId=${imageId}&type=Primary&maxWidth=220&quality=90`;
  const targetId = item.Type === 'Episode' && item.SeriesId ? item.SeriesId : item.Id;
  const href = jellyfinUrl ? `${jellyfinUrl}/web/index.html#!/details?id=${targetId}` : undefined;

  const content = (
    <>
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted mb-1.5 shadow-sm">
        {hasImage ? <FadeInImage src={posterSrc} alt={item.Name} fill sizes="110px" priority={imagePriority} className="object-cover" unoptimized={isProtectedApiImageSrc(posterSrc)} /> : (
          <div className="w-full h-full flex items-center justify-center"><MonitorPlay className="h-6 w-6 text-muted-foreground/20" /></div>
        )}
        <div className="absolute top-1.5 left-1.5">
          <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md ${item.Type === 'Movie' ? 'bg-blue-500/80' : 'bg-purple-500/80'}`}>
            {item.Type === 'Movie' ? <Film className="h-2.5 w-2.5 text-foreground" /> : <Tv className="h-2.5 w-2.5 text-foreground" />}
          </span>
        </div>
        {showProgress && progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-foreground/10"><div className="h-full bg-[var(--hpr-cyan)]" style={{ width: `${progress}%` }} /></div>
        )}
      </div>
      <p className="text-[11px] font-medium truncate leading-tight">{item.SeriesName || item.Name}</p>
      {item.Type === 'Episode' && item.ParentIndexNumber != null && <p className="text-[10px] text-muted-foreground truncate">S{item.ParentIndexNumber}E{item.IndexNumber}</p>}
    </>
  );

  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="snap-start shrink-0 w-[110px]">
      {content}
    </a>
  ) : (
    <div className="snap-start shrink-0 w-[110px]">
      {content}
    </div>
  );
}

function StatCard({ icon: Icon, color, value, label }: { icon: React.ElementType; color: string; value: number; label: string }) {
  const c: Record<string, string> = { blue: 'bg-blue-500/10 text-blue-500', purple: 'bg-purple-500/10 text-purple-500', green: 'bg-green-500/10 text-green-500', indigo: 'bg-indigo-500/10 text-indigo-500' };
  return (
    <div className="rounded-xl bg-card p-4 flex items-center gap-3">
      <div className={`rounded-lg p-2.5 ${c[color] || c.blue}`}><Icon className="h-5 w-5" /></div>
      <div><p className="text-2xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>
    </div>
  );
}

function LibraryCard({ library }: { library: JellyfinLibrary }) {
  const m: Record<string, React.ElementType> = { movies: Film, tvshows: Tv, music: Clapperboard, homevideos: MonitorPlay };
  const Icon = m[library.CollectionType || ''] || Library;
  return (
    <div className="rounded-xl bg-card p-3 flex items-center gap-3">
      <div className="rounded-lg bg-[var(--hpr-cyan)]/10 p-2"><Icon className="h-4 w-4 text-[var(--hpr-cyan)]" /></div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{library.Name}</p>
        <p className="text-xs text-muted-foreground">{library.CollectionType || 'Mixed'}{library.ChildCount != null && ` \u00B7 ${library.ChildCount} items`}</p>
      </div>
    </div>
  );
}

// Inline items shown in a section before the rest move behind "See all".
const SECTION_INLINE_MAX = 8;

function SeeAllButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
      onClick={onClick}
    >
      See all <ChevronRight className="h-3 w-3" />
    </Button>
  );
}

function DevicesSection({
  devices,
  selfDeviceId,
  onRefresh,
}: {
  devices: JellyfinDevice[];
  selfDeviceId: string;
  onRefresh: () => Promise<void>;
}) {
  const [view, setView] = useState<'carousel' | 'list'>('carousel');
  const [seeAll, setSeeAll] = useState(false);
  // `pending` is a device to delete, or the string 'all' for Delete All.
  const [pending, setPending] = useState<JellyfinDevice | 'all' | null>(null);
  const [busy, setBusy] = useState(false);

  const runDelete = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const url = pending === 'all'
        ? '/api/jellyfin/devices'
        : `/api/jellyfin/devices?id=${encodeURIComponent(pending.Id)}`;
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error || 'Failed to delete device');
        return;
      }
      await onRefresh();
      setPending(null);
    } catch {
      toast.error('Failed to delete device');
    } finally {
      setBusy(false);
    }
  }, [pending, onRefresh]);

  const deletable = devices.filter((d) => d.Id !== selfDeviceId);
  const inline = devices.slice(0, SECTION_INLINE_MAX);

  return (
    <div>
      <SectionHeader
        title="Devices"
        badge={<span className="text-xs text-muted-foreground tabular-nums">{devices.length}</span>}
        trailing={
          <div className="flex items-center gap-2">
            <ViewModeToggle value={view} onChange={setView} />
            <SeeAllButton onClick={() => setSeeAll(true)} />
          </div>
        }
      />
      {view === 'carousel' ? (
        <Carousel>
          {inline.map((device) => (
            <DeviceItem key={device.Id} device={device} variant="card" isSelf={device.Id === selfDeviceId} onDelete={setPending} />
          ))}
        </Carousel>
      ) : (
        <div className="space-y-2">
          {inline.map((device) => (
            <DeviceItem key={device.Id} device={device} variant="row" isSelf={device.Id === selfDeviceId} onDelete={setPending} />
          ))}
        </div>
      )}

      <DevicesSeeAllDrawer
        open={seeAll}
        onOpenChange={setSeeAll}
        devices={devices}
        selfDeviceId={selfDeviceId}
        onDelete={setPending}
        onDeleteAll={() => setPending('all')}
      />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => { if (!open && !busy) setPending(null); }}
        title={pending === 'all' ? 'Delete all devices' : 'Delete device'}
        description={
          pending === 'all'
            ? `Delete all ${deletable.length} device(s)? This signs them out of Jellyfin. Helprr's own device is kept.`
            : pending
              ? `Delete "${pending.CustomName || pending.Name}"? This signs it out of Jellyfin.`
              : undefined
        }
        confirmLabel={pending === 'all' ? 'Delete all' : 'Delete'}
        destructive
        busy={busy}
        onConfirm={runDelete}
      />
    </div>
  );
}

function ActivityFeed({ title, entries, alert = false }: { title: string; entries: JellyfinActivityEntry[]; alert?: boolean }) {
  const [view, setView] = useState<'carousel' | 'list'>('carousel');
  const [seeAll, setSeeAll] = useState(false);
  const inline = entries.slice(0, SECTION_INLINE_MAX);

  return (
    <div>
      <SectionHeader
        title={title}
        trailing={
          <div className="flex items-center gap-2">
            <ViewModeToggle value={view} onChange={setView} />
            <SeeAllButton onClick={() => setSeeAll(true)} />
          </div>
        }
      />
      {view === 'carousel' ? (
        <Carousel>
          {inline.map((entry) => (
            <ActivityItem key={entry.Id} entry={entry} variant="card" alert={alert} />
          ))}
        </Carousel>
      ) : (
        <div className="rounded-xl bg-card divide-y divide-border/50">
          {inline.map((entry) => (
            <ActivityItem key={entry.Id} entry={entry} variant="row" alert={alert} />
          ))}
        </div>
      )}

      <ActivitySeeAllDrawer open={seeAll} onOpenChange={setSeeAll} title={title} entries={entries} alert={alert} />
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tab 2: USERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function UsersTab() {
  const [selectedUser, setSelectedUser] = useState<PlaybackUserActivity | null>(null);

  const playbackQuery = useQuery({
    queryKey: ['jellyfin', 'playback', 'users', MAX_DAYS],
    queryFn: jsonFetcher<{ users?: PlaybackUserActivity[]; pluginAvailable?: boolean }>(
      `/api/jellyfin/playback/users?days=${MAX_DAYS}`
    ),
    staleTime: 60_000,
  });
  const jellyfinUsersQuery = useQuery({
    queryKey: ['jellyfin', 'users'],
    queryFn: jsonFetcher<{ users?: JellyfinUser[] }>('/api/jellyfin/users'),
    select: (d) => d.users ?? [],
    staleTime: 60_000,
  });

  // Per-user "recent plays" drawer — fetched on demand when a user is selected.
  // last-30-days window is computed in the queryFn; cached per user via the key.
  const userHistoryQuery = useQuery({
    queryKey: ['jellyfin', 'playback', 'user-history', selectedUser?.user_id],
    queryFn: jsonFetcher<{ items?: CustomHistoryItem[] }>(
      (() => {
        const to = todayStr();
        const from = new Date();
        from.setDate(from.getDate() - 30);
        return `/api/jellyfin/playback/custom-history?from=${toDateStr(from)}&to=${to}&userId=${selectedUser?.user_id}&limit=30`;
      })()
    ),
    select: (d) => d.items ?? [],
    staleTime: 60_000,
    enabled: !!selectedUser,
  });

  const users = playbackQuery.data?.users ?? [];
  const jellyfinUsers = jellyfinUsersQuery.data ?? [];
  const pluginAvailable = playbackQuery.data?.pluginAvailable !== false;
  const userHistory = userHistoryQuery.data ?? [];
  const historyLoading = userHistoryQuery.isLoading;

  function openUserHistory(user: PlaybackUserActivity) {
    setSelectedUser(user);
  }

  if ((playbackQuery.isLoading && !playbackQuery.data) || (jellyfinUsersQuery.isLoading && !jellyfinUsersQuery.data)) return <PageSpinner />;
  if (!pluginAvailable) return <PluginNotice />;
  if (users.length === 0) return <div className="text-center py-16 text-muted-foreground"><Users className="h-8 w-8 mx-auto mb-2 opacity-40" /><p className="text-sm">No user activity found</p></div>;

  return (
    <>
      <div className="space-y-2">
        {users.map((user) => {
          const jfUser = jellyfinUsers.find((u) => u.Id === user.user_id);
          const avatarSrc = jfUser?.PrimaryImageTag ? `/api/jellyfin/image?itemId=${user.user_id}&type=Primary&maxWidth=80&quality=80` : null;
          return (
            <button key={user.user_id} onClick={() => openUserHistory(user)} className="w-full text-left rounded-xl bg-muted/30 p-3 active:bg-muted/50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-[var(--hpr-cyan)]/20 flex items-center justify-center shrink-0 overflow-hidden">
                  {avatarSrc ? <Image src={avatarSrc} alt={user.user_name} width={40} height={40} className="object-cover" unoptimized /> : (
                    <span className="text-sm font-bold text-[var(--hpr-cyan)]">{user.user_name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user.user_name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{user.item_name || 'No recent activity'} &middot; {user.client_name}</p>
                </div>
                <div className="text-right shrink-0"><p className="text-xs text-muted-foreground">{user.last_seen}</p></div>
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{user.total_count} plays</Badge>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{user.total_play_time}</Badge>
              </div>
            </button>
          );
        })}
      </div>

      <Drawer open={!!selectedUser} onOpenChange={(open) => { if (!open) setSelectedUser(null); }}>
        <DrawerContent>
          {selectedUser && (
            <>
              <DrawerHeader className="text-left">
                <DrawerTitle className="text-sm">{selectedUser.user_name} — Recent Plays</DrawerTitle>
                <p className="text-xs text-muted-foreground">{selectedUser.total_count} total plays &middot; {selectedUser.total_play_time}</p>
              </DrawerHeader>
              <div className="px-2 pb-6 flex-1 min-h-0 overflow-y-auto">
                {historyLoading ? (
                  <PageSpinner />
                ) : userHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No plays in the last 30 days</p>
                ) : (
                  <div className="space-y-1">{userHistory.map((e) => <CustomHistoryRow key={e.RowId} item={e} />)}</div>
                )}
              </div>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tab 3: HISTORY (uses submit_custom_query — single API call)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const QUICK_RANGES = [
  { label: '1d', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '3m', days: 90 },
];

const PAGE_SIZE = 50;

function HistoryTab() {
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedFilter, setSelectedFilter] = useState<string>('');
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 6);
    return { from, to };
  });
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Users + filters for the dropdowns (loaded once).
  const userListQuery = useQuery({
    queryKey: ['jellyfin', 'playback', 'user-list'],
    queryFn: jsonFetcher<{ users?: { name: string; id: string }[]; pluginAvailable?: boolean }>(
      '/api/jellyfin/playback/user-list'
    ),
    staleTime: 60_000,
  });
  const filtersQuery = useQuery({
    queryKey: ['jellyfin', 'playback', 'filters'],
    queryFn: jsonFetcher<{ filters?: string[] }>('/api/jellyfin/playback/filters'),
    select: (d) => d.filters ?? [],
    staleTime: 60_000,
  });

  const fromDateStr = dateRange.from ? toDateStr(dateRange.from) : null;
  const toDateStrVal = dateRange.from ? toDateStr(dateRange.to || dateRange.from) : null;

  // Paginated history (offset-based "load more") → useInfiniteQuery keyed on the
  // active filters; changing any filter is a new key (fresh page 0).
  const historyQuery = useInfiniteQuery({
    queryKey: [
      'jellyfin', 'playback', 'custom-history',
      { from: fromDateStr, to: toDateStrVal, userId: selectedUserId, type: selectedFilter },
    ],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        from: fromDateStr!,
        to: toDateStrVal!,
        limit: String(PAGE_SIZE),
        offset: String(pageParam),
      });
      if (selectedUserId) params.set('userId', selectedUserId);
      if (selectedFilter) params.set('type', selectedFilter);
      return jsonFetcher<{ items?: CustomHistoryItem[]; total?: number; pluginAvailable?: boolean }>(
        `/api/jellyfin/playback/custom-history?${params}`
      )({ signal });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      // An empty page means we've reached the end even if `total` over-reports —
      // otherwise the offset stalls and "Load more" refetches the same page.
      if (!lastPage.items?.length) return undefined;
      const loaded = allPages.reduce((n, p) => n + (p.items?.length ?? 0), 0);
      return loaded < (lastPage.total ?? 0) ? loaded : undefined;
    },
    staleTime: 60_000,
    enabled: !!dateRange.from,
  });

  const users = userListQuery.data?.users ?? [];
  const filters = filtersQuery.data ?? [];
  const items = useMemo(
    () => historyQuery.data?.pages.flatMap((p) => p.items ?? []) ?? [],
    [historyQuery.data]
  );
  const total = historyQuery.data?.pages[0]?.total ?? 0;
  const loading = historyQuery.isLoading;
  const loadingMore = historyQuery.isFetchingNextPage;
  // Plugin reports its absence via either meta endpoint or the history payload.
  const pluginAvailable =
    userListQuery.data?.pluginAvailable !== false &&
    historyQuery.data?.pages[0]?.pluginAvailable !== false;

  function applyQuickRange(days: number) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days + 1);
    setDateRange({ from, to });
  }

  if (!pluginAvailable) return <PluginNotice />;

  const fromStr = dateRange.from ? dateRange.from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const toStr = dateRange.to ? dateRange.to.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : fromStr;
  const rangeLabel = fromStr === toStr ? fromStr : `${fromStr} — ${toStr}`;
  const hasMore = items.length < total;

  return (
    <div className="space-y-3">
      {/* Quick range buttons */}
      <div className="flex gap-1.5">
        {QUICK_RANGES.map((r) => (
          <button key={r.label} onClick={() => applyQuickRange(r.days)} className="px-2.5 py-1 rounded-md text-xs font-medium bg-muted/50 text-muted-foreground hover:text-foreground transition-colors">
            {r.label}
          </button>
        ))}
      </div>

      {/* Date range picker */}
      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start text-left text-xs h-9 font-normal">
            <CalendarIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
            {rangeLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={dateRange}
            onSelect={(range) => {
              if (range) setDateRange(range);
              if (range?.to) setCalendarOpen(false);
            }}
            disabled={{ after: new Date() }}
            numberOfMonths={1}
          />
        </PopoverContent>
      </Popover>

      {/* User + type filters */}
      <div className="flex gap-2">
        <Select value={selectedUserId || 'all'} onValueChange={(v) => setSelectedUserId(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="All users" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {filters.length > 0 && (
          <Select value={selectedFilter || 'all'} onValueChange={(v) => setSelectedFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {filters.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Result count */}
      {!loading && total > 0 && (
        <p className="text-[11px] text-muted-foreground">{total} plays found</p>
      )}

      {/* History list */}
      {loading ? (
        <PageSpinner />
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground"><Clock className="h-8 w-8 mx-auto mb-2 opacity-40" /><p className="text-sm">No plays found</p></div>
      ) : (
        <>
          <div className="space-y-1">{items.map((e) => <CustomHistoryRow key={e.RowId} item={e} />)}</div>
          {hasMore && (
            <Button variant="outline" className="w-full text-xs h-9" onClick={() => historyQuery.fetchNextPage()} disabled={loadingMore}>
              {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <ChevronDown className="h-3.5 w-3.5 mr-2" />}
              Load more ({items.length} of {total})
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// ─── History Row (for CustomHistoryItem from submit_custom_query) ───

function getMethodInfo(method: string): { label: string; colorClass: string } {
  const m = method.toLowerCase();
  if (m.startsWith('directplay')) return { label: method, colorClass: 'text-green-500 border-green-500/30' };
  if (m.startsWith('directstream')) return { label: method, colorClass: 'text-blue-500 border-blue-500/30' };
  if (m.startsWith('transcode')) return { label: method, colorClass: 'text-orange-500 border-orange-500/30' };
  return { label: method, colorClass: '' };
}

function CustomHistoryRow({ item }: { item: CustomHistoryItem }) {
  const { label: methodLabel, colorClass: methodColor } = getMethodInfo(item.PlaybackMethod);

  return (
    <div className="flex items-center gap-3 py-1 px-0 rounded-lg hover:bg-muted/30">
      <div className="p-1.5 rounded bg-muted shrink-0">
        {item.ItemType === 'Movie' ? <Film className="h-3.5 w-3.5 text-muted-foreground" /> :
          item.ItemType === 'Episode' ? <Tv className="h-3.5 w-3.5 text-muted-foreground" /> :
            <MonitorPlay className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{item.ItemName}</p>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{item.ClientName}</span><span>&middot;</span><span>{item.DeviceName}</span><span>&middot;</span><span>{formatDurationSeconds(item.PlayDuration)}</span>
        </div>
      </div>
      <div className="text-right shrink-0 space-y-0.5">
        <Badge variant="outline" className={`text-[9px] px-1 py-0 ${methodColor}`}>{methodLabel}</Badge>
        <p className="text-[10px] text-muted-foreground">{formatDateCreated(item.DateCreated)}</p>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tab 4: STATS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type SortMode = 'plays' | 'duration';

function StatsTab() {
  const [days, setDays] = useState(3);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [methodSort, setMethodSort] = useState<SortMode>('duration');
  const [tvSort, setTvSort] = useState<SortMode>('duration');
  const [clientSort, setClientSort] = useState<SortMode>('duration');
  const [deviceSort, setDeviceSort] = useState<SortMode>('duration');
  const [movieSort, setMovieSort] = useState<SortMode>('duration');

  // Shared with HistoryTab's user dropdown (same query key → one fetch).
  const userListQuery = useQuery({
    queryKey: ['jellyfin', 'playback', 'user-list'],
    queryFn: jsonFetcher<{ users?: { id: string; name: string }[]; pluginAvailable?: boolean }>(
      '/api/jellyfin/playback/user-list'
    ),
    staleTime: 60_000,
  });

  const queryDays = days === 0 ? MAX_DAYS : days;
  const statsParams = new URLSearchParams({ days: String(queryDays) });
  if (selectedUserId) statsParams.set('userId', selectedUserId);
  const statsQs = statsParams.toString();
  const statsFilters = { days: queryDays, userId: selectedUserId };

  // Seven independent stat panels keyed on (range, user). Separate queries paint
  // progressively and dedupe naturally; changing the range/user is a new key.
  const activityQ = useQuery({
    queryKey: ['jellyfin', 'playback', 'activity', statsFilters],
    queryFn: jsonFetcher<{ data?: PlayActivityUser[]; pluginAvailable?: boolean }>(`/api/jellyfin/playback/activity?${statsQs}`),
    staleTime: 60_000,
  });
  const tvQ = useQuery({
    queryKey: ['jellyfin', 'playback', 'tv-shows', statsFilters],
    queryFn: jsonFetcher<{ shows?: PlaybackBreakdownEntry[]; pluginAvailable?: boolean }>(`/api/jellyfin/playback/tv-shows?${statsQs}`),
    staleTime: 60_000,
  });
  const movQ = useQuery({
    queryKey: ['jellyfin', 'playback', 'movies', statsFilters],
    queryFn: jsonFetcher<{ movies?: PlaybackBreakdownEntry[]; pluginAvailable?: boolean }>(`/api/jellyfin/playback/movies?${statsQs}`),
    staleTime: 60_000,
  });
  const methodQ = useQuery({
    queryKey: ['jellyfin', 'playback', 'breakdown', 'PlaybackMethod', statsFilters],
    queryFn: jsonFetcher<{ entries?: PlaybackBreakdownEntry[]; pluginAvailable?: boolean }>(`/api/jellyfin/playback/breakdown/PlaybackMethod?${statsQs}`),
    staleTime: 60_000,
  });
  const clientQ = useQuery({
    queryKey: ['jellyfin', 'playback', 'breakdown', 'ClientName', statsFilters],
    queryFn: jsonFetcher<{ entries?: PlaybackBreakdownEntry[]; pluginAvailable?: boolean }>(`/api/jellyfin/playback/breakdown/ClientName?${statsQs}`),
    staleTime: 60_000,
  });
  const deviceQ = useQuery({
    queryKey: ['jellyfin', 'playback', 'breakdown', 'DeviceName', statsFilters],
    queryFn: jsonFetcher<{ entries?: PlaybackBreakdownEntry[]; pluginAvailable?: boolean }>(`/api/jellyfin/playback/breakdown/DeviceName?${statsQs}`),
    staleTime: 60_000,
  });
  const hourlyQ = useQuery({
    queryKey: ['jellyfin', 'playback', 'hourly', statsFilters],
    queryFn: jsonFetcher<{ data?: Record<string, number>; pluginAvailable?: boolean }>(`/api/jellyfin/playback/hourly?${statsQs}`),
    staleTime: 60_000,
  });

  const users = userListQuery.data?.users ?? [];
  const playActivity = activityQ.data?.data ?? [];
  const topTv = tvQ.data?.shows ?? [];
  const topMovies = movQ.data?.movies ?? [];
  const methodBreakdown = methodQ.data?.entries ?? [];
  const clientBreakdown = clientQ.data?.entries ?? [];
  const deviceBreakdown = deviceQ.data?.entries ?? [];
  const hourlyData = hourlyQ.data?.data ?? {};

  // Spinner until the stat panels first resolve; changing range/user is a fresh
  // key, so this re-shows the spinner on every range change (matches the old flow).
  const loading =
    activityQ.isLoading || tvQ.isLoading || movQ.isLoading ||
    methodQ.isLoading || clientQ.isLoading || deviceQ.isLoading || hourlyQ.isLoading;

  // Any endpoint reporting pluginAvailable:false means the plugin is missing.
  const pluginAvailable =
    userListQuery.data?.pluginAvailable !== false &&
    activityQ.data?.pluginAvailable !== false &&
    tvQ.data?.pluginAvailable !== false &&
    movQ.data?.pluginAvailable !== false &&
    methodQ.data?.pluginAvailable !== false &&
    clientQ.data?.pluginAvailable !== false &&
    deviceQ.data?.pluginAvailable !== false &&
    hourlyQ.data?.pluginAvailable !== false;

  if (loading) return <PageSpinner />;

  if (!pluginAvailable) return <div className="space-y-5"><PluginNotice /></div>;

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <div className="flex-1 min-w-0 max-w-xs">
          <Select
            value={String(days)}
            onValueChange={(value) => {
              const parsed = Number.parseInt(value, 10);
              setDays(Number.isNaN(parsed) ? 7 : parsed);
            }}
          >
            <SelectTrigger className="h-8 text-xs w-full">
              <SelectValue placeholder="Range" />
            </SelectTrigger>
            <SelectContent>
              {DAY_RANGES.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d === 0 ? 'All time' : `${d} days`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {users.length > 0 && (
          <div className="flex-1 min-w-0 max-w-xs">
            <Select value={selectedUserId || 'all'} onValueChange={(v) => setSelectedUserId(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-8 text-xs w-full">
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {methodBreakdown.length > 0 && (
        <div>
          <SectionHeader title="Playback Methods" trailing={<SortToggle value={methodSort} onChange={setMethodSort} />} />
          <PlaybackMethodBar entries={methodBreakdown} sortBy={methodSort} />
        </div>
      )}

      {topTv.length > 0 && (
        <div>
          <SectionHeader title="Top TV Shows" trailing={<SortToggle value={tvSort} onChange={setTvSort} />} />
          <RankedList entries={topTv} sortBy={tvSort} limit={10} />
        </div>
      )}

      {topMovies.length > 0 && (
        <div>
          <SectionHeader title="Top Movies" trailing={<SortToggle value={movieSort} onChange={setMovieSort} />} />
          <RankedList entries={topMovies} sortBy={movieSort} limit={10} />
        </div>
      )}

      {clientBreakdown.length > 0 && (
        <div>
          <SectionHeader title="Top Clients" trailing={<SortToggle value={clientSort} onChange={setClientSort} />} />
          <RankedList entries={clientBreakdown} sortBy={clientSort} limit={10} />
        </div>
      )}

      {deviceBreakdown.length > 0 && (
        <div>
          <SectionHeader title="Top Devices" trailing={<SortToggle value={deviceSort} onChange={setDeviceSort} />} />
          <RankedList entries={deviceBreakdown} sortBy={deviceSort} limit={10} />
        </div>
      )}

      {playActivity.length > 0 && (
        <div>
          <SectionHeader title="Play Activity" />
          <PlayActivityChart data={playActivity} />
        </div>
      )}

      {Object.keys(hourlyData).length > 0 && (
        <div>
          <SectionHeader title="Hourly Activity" />
          <HourlyHeatmap data={hourlyData} />
        </div>
      )}

    </div>
  );
}

// ─── Sort Toggle ───

function SortToggle({ value, onChange }: { value: SortMode; onChange: (v: SortMode) => void }) {
  return (
    <button
      onClick={() => onChange(value === 'plays' ? 'duration' : 'plays')}
      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
    >
      <ArrowUpDown className="h-3 w-3" />
      {value === 'plays' ? 'Plays' : 'Duration'}
    </button>
  );
}

// ─── Play Activity Chart ───
// Data: [{user_id, user_name, user_usage: {date: count}}]

function PlayActivityChart({ data }: { data: PlayActivityUser[] }) {
  const chartData = useMemo(() => {
    const realUsers = data.filter((u) => u.user_id !== 'labels_user');
    if (realUsers.length === 0) return null;

    // Merge all users' usage, then strip zero-only dates
    const merged: Record<string, number> = {};
    for (const user of realUsers) {
      for (const [date, val] of Object.entries(user.user_usage)) {
        merged[date] = (merged[date] || 0) + (Number(val) || 0);
      }
    }

    const nonZeroEntries = Object.entries(merged)
      .filter(([, v]) => v > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    if (nonZeroEntries.length === 0) return null;

    // Determine aggregation from actual data span, not the requested days
    const nonZeroCount = nonZeroEntries.length;
    let aggregated: [string, number][];
    let periodLabel: string;

    if (nonZeroCount <= 30) {
      aggregated = nonZeroEntries;
      periodLabel = 'daily';
    } else if (nonZeroCount <= 365) {
      // Weekly aggregation
      const weeks: [string, number][] = [];
      let weekSum = 0;
      let weekStart = nonZeroEntries[0][0];
      for (let i = 0; i < nonZeroEntries.length; i++) {
        weekSum += nonZeroEntries[i][1];
        if ((i + 1) % 7 === 0 || i === nonZeroEntries.length - 1) {
          weeks.push([weekStart, weekSum]);
          weekSum = 0;
          if (i + 1 < nonZeroEntries.length) weekStart = nonZeroEntries[i + 1][0];
        }
      }
      aggregated = weeks;
      periodLabel = 'weekly';
    } else {
      // Monthly aggregation
      const months: Record<string, number> = {};
      for (const [date, count] of nonZeroEntries) {
        const monthKey = date.substring(0, 7);
        months[monthKey] = (months[monthKey] || 0) + count;
      }
      aggregated = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
      periodLabel = 'monthly';
    }

    // Safety cap: if still > 60 bars, collapse to monthly
    if (aggregated.length > 60 && periodLabel !== 'monthly') {
      const months: Record<string, number> = {};
      for (const [date, count] of nonZeroEntries) {
        const monthKey = date.substring(0, 7);
        months[monthKey] = (months[monthKey] || 0) + count;
      }
      aggregated = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
      periodLabel = 'monthly';
    }

    const totalPlays = aggregated.reduce((s, [, v]) => s + v, 0);
    const maxVal = Math.max(...aggregated.map(([, v]) => v), 1);

    // Compute avg from actual date span
    const firstDate = new Date(nonZeroEntries[0][0] + 'T12:00:00');
    const lastDate = new Date(nonZeroEntries[nonZeroEntries.length - 1][0] + 'T12:00:00');
    const actualDays = Math.max(1, Math.round((lastDate.getTime() - firstDate.getTime()) / (86400000)) + 1);
    const avgPerDay = (totalPlays / actualDays).toFixed(1);

    const labelInterval = Math.max(1, Math.ceil(aggregated.length / 7));
    const isMonthly = periodLabel === 'monthly';

    // Pre-compute per-user stacked values (avoids work during render)
    let userBars: Record<string, number[]> | null = null;
    if (realUsers.length > 1) {
      userBars = {};

      if (periodLabel === 'daily') {
        for (const [label] of aggregated) {
          userBars[label] = realUsers.map((u) => Number(u.user_usage[label]) || 0);
        }
      } else if (periodLabel === 'weekly') {
        // Map each non-zero date to its week label
        const dateToWeekLabel: Record<string, string> = {};
        let curWeekStart = nonZeroEntries[0][0];
        for (let i = 0; i < nonZeroEntries.length; i++) {
          dateToWeekLabel[nonZeroEntries[i][0]] = curWeekStart;
          if ((i + 1) % 7 === 0 && i + 1 < nonZeroEntries.length) {
            curWeekStart = nonZeroEntries[i + 1][0];
          }
        }
        for (const [label] of aggregated) userBars[label] = realUsers.map(() => 0);
        for (const [date] of nonZeroEntries) {
          const wl = dateToWeekLabel[date];
          if (wl && userBars[wl]) {
            realUsers.forEach((u, i) => { userBars![wl][i] += Number(u.user_usage[date]) || 0; });
          }
        }
      } else {
        // Monthly
        for (const [label] of aggregated) userBars[label] = realUsers.map(() => 0);
        for (const [date] of nonZeroEntries) {
          const mk = date.substring(0, 7);
          if (userBars[mk]) {
            realUsers.forEach((u, i) => { userBars![mk][i] += Number(u.user_usage[date]) || 0; });
          }
        }
      }
    }

    return { realUsers, aggregated, totalPlays, maxVal, avgPerDay, periodLabel, labelInterval, userBars, isMonthly };
  }, [data]);

  if (!chartData) return null;
  const { realUsers, aggregated, totalPlays, maxVal, avgPerDay, periodLabel, labelInterval, userBars, isMonthly } = chartData;

  return (
    <div className="rounded-xl bg-card p-3">
      {/* Summary */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-lg font-bold tabular-nums">{totalPlays}</span>
        <span className="text-xs text-muted-foreground">total plays</span>
        <span className="text-xs text-muted-foreground ml-auto">~{avgPerDay}/day avg</span>
      </div>

      {/* Per-user legend if multiple users */}
      {realUsers.length > 1 && (
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          {realUsers.map((u, i) => (
            <div key={u.user_id} className="flex items-center gap-1 text-[10px]">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: USER_COLORS[i % USER_COLORS.length] }} />
              <span className="text-muted-foreground">{u.user_name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Bars */}
      <div className="flex items-end gap-[2px] h-24">
        {aggregated.map(([label, count]) => {
          const pct = (count / maxVal) * 100;

          if (userBars && userBars[label]) {
            const userValues = userBars[label];
            const userTotal = userValues.reduce((s, v) => s + v, 0) || 1;
            return (
              <div key={label} className="flex-1 flex flex-col items-center justify-end h-full min-w-0" title={`${label}: ${count}`}>
                <div className="w-full rounded-t-sm overflow-hidden min-h-[2px] flex flex-col-reverse" style={{ height: `${Math.max(pct, 2)}%` }}>
                  {userValues.map((val, i) => {
                    if (val === 0) return null;
                    return (
                      <div key={i} style={{
                        height: `${(val / userTotal) * 100}%`,
                        backgroundColor: USER_COLORS[i % USER_COLORS.length],
                        minHeight: 1,
                      }} />
                    );
                  })}
                </div>
              </div>
            );
          }

          return (
            <div key={label} className="flex-1 flex flex-col items-center justify-end h-full min-w-0" title={`${label}: ${count}`}>
              <div className="w-full rounded-t-sm bg-[var(--hpr-cyan)] min-h-[2px]" style={{ height: `${Math.max(pct, 2)}%` }} />
            </div>
          );
        })}
      </div>

      {/* Date labels */}
      <div className="flex gap-[2px] mt-1">
        {aggregated.map(([label], i) => (
          <div key={label} className="flex-1 text-center min-w-0">
            {(i % labelInterval === 0 || i === aggregated.length - 1) ? (
              <span className="text-[8px] text-muted-foreground">
                {isMonthly
                  ? new Date(label + '-15').toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
                  : new Date(label + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                }
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground mt-1.5 text-center">{periodLabel} view</p>
    </div>
  );
}

const USER_COLORS = [
  'var(--hpr-cyan)',
  'var(--hpr-amber)',
  'var(--hpr-green)',
  'var(--hpr-rose)',
  'var(--hpr-violet)',
  'var(--hpr-pink)',
];

// ─── Ranked List (with sort toggle) ───

function RankedList({ entries, sortBy, limit }: { entries: PlaybackBreakdownEntry[]; sortBy: SortMode; limit?: number }) {
  const sorted = useMemo(() => {
    return [...entries]
      .map((e) => ({ ...e, count: Number(e.count) || 0, time: Number(e.time) || 0 }))
      .sort((a, b) => sortBy === 'duration' ? b.time - a.time : b.count - a.count)
      .slice(0, limit ?? entries.length);
  }, [entries, sortBy, limit]);

  const maxVal = Math.max(...sorted.map((e) => sortBy === 'duration' ? e.time : e.count), 1);

  return (
    <div className="rounded-xl bg-card overflow-hidden divide-y divide-border/50">
      {sorted.map((entry, i) => (
        <div key={`${entry.label}-${i}`} className="relative px-3 py-2.5 flex items-center gap-3">
          <div className="absolute inset-0 bg-[var(--hpr-cyan)]/5" style={{ width: `${((sortBy === 'duration' ? entry.time : entry.count) / maxVal) * 100}%` }} />
          <span className="text-xs text-muted-foreground font-mono w-5 shrink-0 relative">{i + 1}</span>
          <span className="text-sm truncate flex-1 relative">{entry.label}</span>
          <div className="text-right shrink-0 relative">
            <span className="text-xs font-medium tabular-nums">
              {sortBy === 'duration' ? formatDurationSeconds(entry.time) : `${entry.count} plays`}
            </span>
            <p className="text-[10px] text-muted-foreground">
              {sortBy === 'duration' ? `${entry.count} plays` : entry.time > 0 ? formatDurationSeconds(entry.time) : ''}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Playback Method Bar (detailed — no grouping) ───

function PlaybackMethodBar({ entries, sortBy }: { entries: PlaybackBreakdownEntry[]; sortBy: SortMode }) {
  const normalized = entries
    .map((e) => ({ ...e, count: Number(e.count) || 0, time: Number(e.time) || 0 }))
    .sort((a, b) => sortBy === 'duration' ? b.time - a.time : b.count - a.count);
  const total = normalized.reduce((sum, e) => sum + (sortBy === 'duration' ? e.time : e.count), 0) || 1;

  function getColor(label: string) {
    const m = label.toLowerCase();
    if (m.startsWith('directplay')) return { bar: 'bg-green-500', dot: 'bg-green-500', text: 'text-green-500' };
    if (m.startsWith('directstream')) return { bar: 'bg-blue-500', dot: 'bg-blue-500', text: 'text-blue-500' };
    if (m.startsWith('transcode')) return { bar: 'bg-orange-500', dot: 'bg-orange-500', text: 'text-orange-500' };
    return { bar: 'bg-muted', dot: 'bg-muted', text: 'text-muted-foreground' };
  }

  return (
    <div className="rounded-xl bg-card p-3 px-2 space-y-3">
      {/* Stacked bar */}
      <div className="flex h-5 rounded-full overflow-hidden">
        {normalized.map((e) => {
          const metric = sortBy === 'duration' ? e.time : e.count;
          const pct = (metric / total) * 100;
          if (pct < 0.5) return null;
          return <div key={e.label} className={`${getColor(e.label).bar} transition-all`} style={{ width: `${pct}%` }} title={`${e.label}: ${pct.toFixed(1)}%`} />;
        })}
      </div>

      {/* Detailed breakdown list */}
      <div className="space-y-1">
        {normalized.map((e) => {
          const metric = sortBy === 'duration' ? e.time : e.count;
          const pct = ((metric / total) * 100).toFixed(1);
          const colors = getColor(e.label);
          return (
            <div key={e.label} className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
              <span className="text-xs truncate flex-1">{e.label}</span>
              <span className="text-[11px] font-medium tabular-nums shrink-0">
                {sortBy === 'duration' ? formatDurationSeconds(e.time) : e.count}
              </span>
              <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right shrink-0">{pct}%</span>
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                {sortBy === 'duration' ? `${e.count} plays` : formatDurationSeconds(e.time)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Hourly Heatmap ───
// Data keys: "dayIdx-hour" e.g. "0-00" through "6-23", values = seconds

function HourlyHeatmap({ data }: { data: Record<string, number> }) {
  const values = Object.values(data).filter((v) => v > 0);
  const maxVal = Math.max(...values, 1);
  const totalSecs = values.reduce((s, v) => s + v, 0);
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Find peak hour
  let peakDay = 0;
  let peakHour = 0;
  let peakVal = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const key = `${d}-${String(h).padStart(2, '0')}`;
      const v = data[key] || 0;
      if (v > peakVal) { peakVal = v; peakDay = d; peakHour = h; }
    }
  }

  return (
    <div className="rounded-xl bg-card p-3 space-y-2">
      {/* Summary */}
      <div className="flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span>Total: {formatDurationSeconds(totalSecs)}</span>
        {peakVal > 0 && <span>Peak: {dayLabels[peakDay]} {peakHour}:00</span>}
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
        <div className="min-w-[300px]">
          <div className="flex ml-8 mb-0.5">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="flex-1 text-center text-[7px] text-muted-foreground">{h % 4 === 0 ? `${h}` : ''}</div>
            ))}
          </div>
          {dayLabels.map((day, dayIdx) => (
            <div key={day} className="flex items-center gap-1 mb-[2px]">
              <span className="text-[8px] text-muted-foreground w-7 shrink-0 text-right">{day}</span>
              <div className="flex-1 flex gap-[1px]">
                {Array.from({ length: 24 }, (_, h) => {
                  const key = `${dayIdx}-${String(h).padStart(2, '0')}`;
                  const val = data[key] || 0;
                  const intensity = val / maxVal;
                  return (
                    <div key={h} className="flex-1 aspect-square rounded-[2px]" style={{
                      backgroundColor: intensity > 0 ? `color-mix(in oklab, var(--hpr-cyan) ${(0.12 + intensity * 0.88) * 100}%, transparent)` : 'color-mix(in oklab, var(--foreground) 4%, transparent)',
                    }} title={`${day} ${h}:00 — ${formatDurationSeconds(val)}`} />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-1">
        <span className="text-[8px] text-muted-foreground mr-0.5">Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((i) => (
          <div key={i} className="w-3 h-3 rounded-[2px]" style={{
            backgroundColor: i === 0 ? 'color-mix(in oklab, var(--foreground) 4%, transparent)' : `color-mix(in oklab, var(--hpr-cyan) ${(0.12 + i * 0.88) * 100}%, transparent)`,
          }} />
        ))}
        <span className="text-[8px] text-muted-foreground ml-0.5">More</span>
      </div>
    </div>
  );
}

// ─── Scheduled Tasks ───

function TaskStatusIcon({ status, state }: { status?: string; state: string }) {
  if (state === 'Running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--hpr-cyan)] shrink-0" />;
  if (state === 'Cancelling') return <XCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
  if (status === 'Completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
  if (status === 'Failed' || status === 'Aborted') return <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
  return <Clock className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />;
}

function ScheduledTasksList({ tasks, onRefresh }: { tasks: JellyfinScheduledTask[]; onRefresh?: () => Promise<void> }) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const { refreshing, refresh } = useRefreshAction(() => onRefresh?.());
  const [busyTasks, setBusyTasks] = useState<Set<string>>(new Set());

  const handleTaskAction = useCallback(async (taskId: string, action: 'start' | 'stop') => {
    setBusyTasks((prev) => new Set(prev).add(taskId));
    try {
      const res = await fetch(`/api/jellyfin/tasks/${taskId}`, {
        method: action === 'start' ? 'POST' : 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || `Failed to ${action} task`);
        return;
      }
      await onRefresh?.();
    } catch {
      toast.error(`Failed to ${action} task`);
    } finally {
      setBusyTasks((prev) => { const next = new Set(prev); next.delete(taskId); return next; });
    }
  }, [onRefresh]);

  // Filter out hidden tasks
  const visible = useMemo(() => tasks.filter((t) => !t.IsHidden), [tasks]);

  const active = useMemo(() => visible.filter((t) => t.State === 'Running' || t.State === 'Cancelling'), [visible]);

  const failed = useMemo(() => visible.filter(
    (t) => t.State === 'Idle' && t.LastExecutionResult?.Status && t.LastExecutionResult.Status !== 'Completed'
  ), [visible]);

  // Group all tasks by category (includes running tasks so counts are accurate)
  const categories = useMemo(() => {
    const grouped: Record<string, typeof visible> = {};
    for (const t of visible) {
      const cat = t.Category || 'Other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(t);
    }
    // Sort categories: ones with recent activity first
    return Object.entries(grouped).sort((a, b) => {
      const aLatest = a[1].reduce((max, t) => {
        const end = t.LastExecutionResult?.EndTimeUtc;
        return end && end > max ? end : max;
      }, '');
      const bLatest = b[1].reduce((max, t) => {
        const end = t.LastExecutionResult?.EndTimeUtc;
        return end && end > max ? end : max;
      }, '');
      return bLatest.localeCompare(aLatest);
    });
  }, [visible]);

  // Summary stats
  const totalCount = visible.length;
  const runningCount = active.length;
  const completedCount = visible.filter((t) => t.LastExecutionResult?.Status === 'Completed').length;
  const failedCount = failed.length;

  if (totalCount === 0) return null;

  return (
    <div>
      <SectionHeader
        title="Scheduled Tasks"
        badge={runningCount > 0 ? <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-[var(--hpr-cyan)]/15 text-[var(--hpr-cyan)]">{runningCount} running</Badge> : undefined}
        trailing={onRefresh && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={refreshing}
            onClick={refresh}
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        )}
      />

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-lg bg-card px-3 py-2 text-center">
          <p className="text-lg font-semibold tabular-nums">{totalCount}</p>
          <p className="text-[10px] text-muted-foreground">Total</p>
        </div>
        <div className="rounded-lg bg-card px-3 py-2 text-center">
          <p className="text-lg font-semibold tabular-nums text-emerald-500">{completedCount}</p>
          <p className="text-[10px] text-muted-foreground">Completed</p>
        </div>
        <div className="rounded-lg bg-card px-3 py-2 text-center">
          <p className={`text-lg font-semibold tabular-nums ${failedCount > 0 ? 'text-red-500' : 'text-muted-foreground/50'}`}>{failedCount}</p>
          <p className="text-[10px] text-muted-foreground">Failed</p>
        </div>
      </div>

      {/* Active tasks */}
      {active.length > 0 && (
        <div className="rounded-xl bg-card overflow-hidden divide-y divide-border/50 mb-3">
          {active.map((t) => (
            <div key={t.Id} className="px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--hpr-cyan)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{t.Name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{t.Category}</p>
                </div>
                <span className="text-xs font-medium text-[var(--hpr-cyan)] tabular-nums shrink-0">
                  {t.CurrentProgressPercentage != null ? `${t.CurrentProgressPercentage.toFixed(0)}%` : 'Running'}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                  disabled={busyTasks.has(t.Id)}
                  onClick={() => handleTaskAction(t.Id, 'stop')}
                >
                  {busyTasks.has(t.Id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
                </Button>
              </div>
              {t.CurrentProgressPercentage != null && (
                <div className="mt-2 ml-6">
                  <Progress value={t.CurrentProgressPercentage} className="h-1.5" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Failed tasks */}
      {failed.length > 0 && (
        <div className="rounded-xl bg-red-500/5 border border-red-500/20 overflow-hidden divide-y divide-red-500/10 mb-3">
          {failed.map((t) => (
            <div key={t.Id} className="px-3 py-2.5 flex items-center gap-2.5">
              <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{t.Name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-red-400">{t.LastExecutionResult?.Status}</span>
                  {t.LastExecutionResult?.EndTimeUtc && (
                    <span className="text-[10px] text-muted-foreground">{timeAgo(t.LastExecutionResult.EndTimeUtc)}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Categories */}
      <div className="rounded-xl bg-card overflow-hidden divide-y divide-border/50">
        {categories.map(([category, catTasks]) => {
          const isExpanded = expandedCategory === category;
          const catRunning = catTasks.filter((t) => t.State === 'Running').length;
          const catCompleted = catTasks.filter((t) => t.LastExecutionResult?.Status === 'Completed').length;
          const latestRun = catTasks.reduce((latest, t) => {
            const end = t.LastExecutionResult?.EndTimeUtc;
            return end && end > latest ? end : latest;
          }, '');

          return (
            <div key={category}>
              <button
                onClick={() => setExpandedCategory(isExpanded ? null : category)}
                className="w-full px-3 py-2.5 flex items-center gap-2.5 hover:bg-muted/30 transition-colors"
              >
                <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium">{category}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {catTasks.length} task{catTasks.length !== 1 ? 's' : ''}
                    {catRunning > 0 && <span className="text-[var(--hpr-cyan)]"> &middot; {catRunning} running</span>}
                    {latestRun && <span> &middot; {timeAgo(latestRun)}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] text-emerald-500 tabular-nums">{catCompleted}</span>
                  <span className="text-[10px] text-muted-foreground/50">/</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{catTasks.length}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="bg-muted/10 divide-y divide-border/30">
                  {catTasks
                    .sort((a, b) => (b.LastExecutionResult?.EndTimeUtc || '').localeCompare(a.LastExecutionResult?.EndTimeUtc || ''))
                    .map((t) => {
                      const schedule = formatTriggerSchedule(t.Triggers || []);
                      const lastEnd = t.LastExecutionResult?.EndTimeUtc;
                      const lastStart = t.LastExecutionResult?.StartTimeUtc;
                      const duration = lastStart && lastEnd ? taskRunDuration(lastStart, lastEnd) : null;

                      const isRunning = t.State === 'Running';
                      const isBusy = busyTasks.has(t.Id);

                      return (
                        <div key={t.Id} className="px-3 py-2.5 pl-9">
                          <div className="flex items-start gap-2.5">
                            <TaskStatusIcon status={t.LastExecutionResult?.Status} state={t.State} />
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] truncate">{t.Name}</p>
                              {t.Description && (
                                <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{t.Description}</p>
                              )}
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <Timer className="h-2.5 w-2.5" />
                                  {schedule}
                                </span>
                                {lastEnd && (
                                  <span className="text-[10px] text-muted-foreground">
                                    Last: {timeAgo(lastEnd)}
                                  </span>
                                )}
                                {duration && (
                                  <span className="text-[10px] text-muted-foreground tabular-nums">
                                    {duration}
                                  </span>
                                )}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`h-6 w-6 shrink-0 ${isRunning ? 'text-red-500 hover:text-red-400 hover:bg-red-500/10' : 'text-[var(--hpr-cyan)] hover:text-[var(--hpr-cyan)]/80 hover:bg-[var(--hpr-cyan)]/10'}`}
                              disabled={isBusy}
                              onClick={() => handleTaskAction(t.Id, isRunning ? 'stop' : 'start')}
                            >
                              {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : isRunning ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
