'use client';

import { useRouteViewState } from '@/lib/hooks/use-route-view-state';
import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { FadeInImage } from '@/components/media/fade-in-image';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Film,
  Tv,
  MonitorPlay,
  Loader2,
  Server,
  CheckCircle2,
  Clapperboard,
  ChevronRight,
  RotateCw,
  Power,
  FolderSync,
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type {
  JellyfinSession,
  JellyfinItem,
  JellyfinSystemInfo,
  JellyfinItemCounts,
  JellyfinDevice,
  JellyfinActivityEntry,
  JellyfinScheduledTask,
} from '@/types/jellyfin';
import { toast } from 'sonner';
import { isProtectedApiImageSrc } from '@/lib/image';
import { SessionCard } from '@/components/jellyfin/session-card';
import { StreamInfoDrawer } from '@/components/jellyfin/stream-info-drawer';
import { DeviceItem, DevicesSeeAllDrawer } from '@/components/jellyfin/device-item';
import { ActivityItem, ActivitySeeAllDrawer } from '@/components/jellyfin/activity-item';
import { ViewModeToggle } from '@/components/widgets/bento-primitives';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useExternalUrls } from '@/lib/hooks/use-external-urls';
import { useCan } from '@/components/permission-provider';
import { ScheduledTasksList } from './scheduled-tasks';
import { Carousel, SectionHeader, ServerErrorState } from './shared';

type JellyfinServerAction = 'restart' | 'shutdown' | 'scan-libraries';

const SERVER_ACTION_LABELS: Record<JellyfinServerAction, string> = {
  restart: 'restart the Jellyfin server',
  shutdown: 'shut down the Jellyfin server',
  'scan-libraries': 'scan all libraries',
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tab 1: OVERVIEW
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function OverviewTab() {
  const queryClient = useQueryClient();
  const [selectedSession, setSelectedSession] = useState<JellyfinSession | null>(null);
  const [serverAction, setServerAction] = useState<string | null>(null);
  const [pendingServerAction, setPendingServerAction] = useState<JellyfinServerAction | null>(null);
  const externalUrls = useExternalUrls();
  const jellyfinUrl = externalUrls.JELLYFIN;
  // Server info, scan/restart/shutdown, and scheduled tasks are admin-only —
  // members never see (or fetch) them.
  const canControl = useCan('jellyfin.control');
  // Who is watching is jellyfin.sessions; without it there is nothing to ask for.
  const canSessions = useCan('jellyfin.sessions');

  // ── Always-on slices ──────────────────────────────────────────────
  // sessions + resume are the live data (who's watching / progress) — they poll
  // every 15s while the tab is focused (staleTime:0). counts/recently-added and
  // the other admin slices rarely change, so they hold a 60s staleTime — no
  // refetch on every mount/tab-return within that window.
  const sessionsQuery = useQuery({
    queryKey: ['jellyfin', 'sessions'],
    queryFn: jsonFetcher<{ sessions?: JellyfinSession[] }>('/api/jellyfin/sessions'),
    select: (d) => d.sessions ?? [],
    enabled: canSessions,
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

  // All always-on slices failed with nothing cached to show: the server is
  // unreachable, not "empty" — every section below would silently vanish.
  if (
    (sessionsQuery.isError || !canSessions) && resumeQuery.isError && countsQuery.isError && recentQuery.isError
    && !sessionsQuery.data && !resumeQuery.data && !countsQuery.data && !recentQuery.data
  ) {
    return (
      <ServerErrorState
        onRetry={() => {
          if (canSessions) void sessionsQuery.refetch();
          void resumeQuery.refetch();
          void countsQuery.refetch();
          void recentQuery.refetch();
        }}
      />
    );
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
          <Carousel restorationKey="active-sessions">{sessions.map((s) => <SessionCard key={s.Id} session={s} variant="full" onInfoClick={setSelectedSession} jellyfinUrl={jellyfinUrl} />)}</Carousel>
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
            {/* Restart and shut down sit behind a menu (each still confirms), away
                from the everyday Scan Libraries button. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-3 text-[11px] text-muted-foreground"
                  aria-label="Server power"
                  disabled={serverAction !== null}
                >
                  {serverAction === 'restart' || serverAction === 'shutdown' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
                  Power
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleServerAction('restart')}>
                  <RotateCw className="h-4 w-4" /> Restart
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => handleServerAction('shutdown')}>
                  <Power className="h-4 w-4" /> Shut down
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
      
      {canControl && tasks.length > 0 && <ScheduledTasksList tasks={tasks} onRefresh={refreshTasks} />}

      {counts && (
        <div className="grid gap-3 grid-cols-2">
          <StatCard icon={Film} color="blue" value={counts.MovieCount} label="Movies" />
          <StatCard icon={Tv} color="purple" value={counts.SeriesCount} label="Series" />
          <StatCard icon={Clapperboard} color="indigo" value={counts.EpisodeCount} label="Episodes" />
          {canSessions && <StatCard icon={MonitorPlay} color="green" value={sessions.length} label="Streams" />}
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
          <Carousel restorationKey="continue-watching">{resumeItems.map((item, i) => <PosterCard key={item.Id} item={item} showProgress jellyfinUrl={jellyfinUrl} imagePriority={i < 4} />)}</Carousel>
        </div>
      )}

      {recentlyAdded.length > 0 && (
        <div>
          <SectionHeader title="Recently Added" />
          <Carousel restorationKey="recently-added">{recentlyAdded.map((item, i) => <PosterCard key={item.Id} item={item} jellyfinUrl={jellyfinUrl} imagePriority={i < 4} />)}</Carousel>
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
  const [view, setView] = useRouteViewState<'carousel' | 'list'>('DevicesSection:view', 'carousel');
  const [seeAll, setSeeAll] = useRouteViewState('DevicesSection:seeAll', false);
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
        <Carousel restorationKey="devices">
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
  const [view, setView] = useRouteViewState<'carousel' | 'list'>('ActivityFeed:view', 'carousel');
  const [seeAll, setSeeAll] = useRouteViewState('ActivityFeed:seeAll', false);
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
        <Carousel restorationKey={`activity:${title}`}>
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
