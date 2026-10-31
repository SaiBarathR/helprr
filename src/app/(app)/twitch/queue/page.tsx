'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, ExternalLink, Filter, Info, Plus, RefreshCw, RotateCcw, User, X } from 'lucide-react';
import { toast } from 'sonner';
import Link from '@/components/ui/app-link';
import { useMe, hasCapability } from '@/components/permission-provider';
import { FadeInImage } from '@/components/media/fade-in-image';
import { GroupedSection } from '@/components/settings/grouped-section';
import { FilterDot } from '@/components/ui/active-filter-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ErrorState } from '@/components/ui/error-state';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { Progress } from '@/components/ui/progress';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { QuickContextMenu, type ContextActionGroup } from '@/components/ui/quick-context-menu';
import { SwipeRow, type SwipeAction } from '@/components/ui/swipe-row';
import { ActionsMenu } from '@/components/twitch/actions-menu';
import { ToolbarButton, toolbarButtonClass, TwitchToolbar } from '@/components/twitch/twitch-toolbar';
import { formatDuration, stageLabel } from '@/components/twitch/types';
import { useRouteViewState } from '@/lib/hooks/use-route-view-state';
import { toCachedImageSrc } from '@/lib/image';
import { backoffRefetchInterval } from '@/lib/query-fetch';
import { cn } from '@/lib/utils';

interface Job {
  id: string;
  kind: string;
  requestedByUserId: string | null;
  state: string;
  stage: string | null;
  progress: number | null;
  speedBps: number | null;
  etaSeconds: number | null;
  bytesDone: number | null;
  bytesTotal: number | null;
  errorClass: string | null;
  video: {
    id: string;
    twitchVideoId: string;
    title: string;
    thumbnailUrl: string | null;
    streamer: { id: string; displayName: string };
  } | null;
}

interface WorkerStatus {
  online: boolean;
  seen: boolean;
  tools?: { ytdlp?: string | null; td?: string | null };
  toolLatest?: { ytdlp?: string; td?: string };
  toolsPaused?: boolean;
  toolUpdatePending?: boolean;
  gpuAvailable?: boolean;
  reencodeWindow?: { open: boolean; start: string } | null;
  diskFreeBytes?: number | null;
}

const ACTIVE = new Set(['RUNNING']);
const WAITING = new Set(['QUEUED', 'RETRY_WAIT', 'BLOCKED']);
const DONE_SHOWN = 20;

const SECTIONS = [
  { id: 'active', label: 'Downloading' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'failed', label: 'Failed' },
  { id: 'done', label: 'Done' },
] as const;

const STATE_BADGES: Record<string, { label: string; className: string }> = {
  RUNNING: { label: 'Downloading', className: 'bg-primary/15 text-primary' },
  QUEUED: { label: 'Queued', className: '' },
  RETRY_WAIT: { label: 'Retrying soon', className: 'bg-amber-500/15 text-amber-400' },
  BLOCKED: { label: 'Disk full', className: 'bg-amber-500/15 text-amber-400' },
  FAILED: { label: 'Failed', className: 'bg-red-500/15 text-red-400' },
  DONE: { label: 'Done', className: 'bg-green-500/15 text-green-400' },
};

const ERROR_LABELS: Record<string, string> = {
  auth: 'Twitch refused access',
  subOnly: 'Subscribers only',
  gone: 'The video is gone',
  validation: 'The file failed its checks',
  extractor: 'Twitch changed something the download tool relies on',
  transient: 'Network or Twitch error',
  disk: 'Not enough disk space',
};

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function diskSize(bytes: number): string {
  const tb = bytes / 1024 ** 4;
  return tb >= 1 ? `${tb.toFixed(1)} TB` : gb(bytes);
}

function JobRow({ job, onCancel, onRetry }: { job: Job; onCancel?: () => void; onRetry?: () => void }) {
  const video = job.video;
  const progress = Math.round((job.progress ?? 0) * 100);
  const badge = STATE_BADGES[job.state] ?? { label: job.state.toLowerCase(), className: '' };
  const thumbnail = toCachedImageSrc(video?.thumbnailUrl, undefined, { width: 240 });
  const running = job.state === 'RUNNING';
  const subtitle = job.state === 'FAILED'
    ? ERROR_LABELS[job.errorClass ?? ''] ?? 'Failed'
    : video?.streamer.displayName;
  const speed = [
    job.speedBps ? `${(job.speedBps / 1024 ** 2).toFixed(1)} MB/s` : null,
    job.bytesTotal ? gb(job.bytesTotal) : null,
    job.etaSeconds ? `${formatDuration(job.etaSeconds)} left` : null,
  ].filter(Boolean).join(' · ');

  const groups: ContextActionGroup[] = [
    {
      id: 'open',
      actions: video ? [
        { id: 'open', label: 'View video', icon: <Info className="h-4 w-4" />, href: `/twitch/vod/${video.id}` },
        { id: 'streamer', label: video.streamer.displayName, icon: <User className="h-4 w-4" />, href: `/twitch/streamers/${video.streamer.id}` },
        { id: 'twitch', label: 'Open on Twitch', icon: <ExternalLink className="h-4 w-4" />, href: `https://www.twitch.tv/videos/${video.twitchVideoId}`, external: true },
      ] : [],
    },
    {
      id: 'job',
      actions: [
        ...(onRetry ? [{ id: 'retry', label: 'Retry', icon: <RotateCcw className="h-4 w-4" />, onSelect: onRetry }] : []),
        ...(onCancel ? [{ id: 'cancel', label: 'Cancel download', icon: <X className="h-4 w-4" />, destructive: true, onSelect: onCancel }] : []),
      ],
    },
  ];
  const leftAction: SwipeAction | undefined = onRetry
    ? { label: 'Retry', icon: <RotateCcw className="h-4 w-4" />, className: 'bg-primary text-primary-foreground', onAction: onRetry }
    : undefined;
  const rightAction: SwipeAction | undefined = onCancel
    ? { label: 'Cancel', icon: <X className="h-4 w-4" />, className: 'bg-destructive text-destructive-foreground', onAction: onCancel }
    : undefined;

  const body = (
    <>
      <span className="relative block aspect-video w-20 shrink-0 overflow-hidden rounded-md bg-muted">
        {thumbnail && <FadeInImage src={thumbnail} alt="" fill sizes="80px" className="object-cover" unoptimized />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{video?.title ?? 'Video'}</span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5">
          <Badge variant="secondary" className={cn('shrink-0 px-1.5 py-0 text-[10px]', badge.className)}>{running && job.stage ? stageLabel(job.stage) : badge.label}</Badge>
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">{subtitle}</span>
        </span>
        {running && (
          <>
            <span className="mt-2 flex items-center gap-2">
              <Progress value={progress} className="h-1.5 flex-1" />
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{progress}%</span>
            </span>
            {speed && <span className="mt-1 block truncate text-[10px] text-muted-foreground">{speed}</span>}
          </>
        )}
      </span>
    </>
  );

  return (
    <SwipeRow contentClassName="bg-card" leftAction={leftAction} rightAction={rightAction}>
      <div className="flex items-center">
        <QuickContextMenu label={`${video?.title ?? 'Download'} actions`} groups={groups}>
          {video ? (
            <Link href={`/twitch/vod/${video.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 active:bg-foreground/5">{body}</Link>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3">{body}</div>
          )}
        </QuickContextMenu>
        <ActionsMenu
          label={`Actions for ${video?.title ?? 'this download'}`}
          groups={groups}
          className="flex h-11 w-9 shrink-0 items-center justify-center text-muted-foreground"
        />
      </div>
    </SwipeRow>
  );
}

function WorkerRow({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="grouped-row gap-3">
      <span className="shrink-0 text-sm">{label}</span>
      <span className={cn('min-w-0 truncate text-sm text-muted-foreground', tone)}>{value}</span>
    </div>
  );
}

export default function TwitchQueuePage() {
  const queryClient = useQueryClient();
  const me = useMe();
  const canManage = hasCapability(me, 'twitch.manage');
  const canDownload = hasCapability(me, 'twitch.download');
  // The same rule as the cancel and retry routes.
  const owns = (job: Job) => canDownload && job.requestedByUserId === me?.id;
  const canCancel = (job: Job) => canManage || owns(job);
  const canRetry = (job: Job) => canManage || (job.kind === 'DOWNLOAD' && owns(job));
  const [section, setSection] = useRouteViewState('section', '');
  const [workerOpen, setWorkerOpen] = useState(false);
  const [cancelling, setCancelling] = useState<Job | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['twitch'] });

  const jobsQuery = useQuery({
    queryKey: ['twitch', 'jobs'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/twitch/jobs', { signal });
      if (!res.ok) throw new Error('Failed to load the queue');
      return (await res.json()) as { jobs: Job[] };
    },
    refetchInterval: (query) => {
      const anyActive = query.state.data?.jobs.some((job) => ACTIVE.has(job.state) || WAITING.has(job.state));
      return anyActive ? backoffRefetchInterval(2_000)(query) : 15_000;
    },
    refetchIntervalInBackground: false,
  });
  const jobs = jobsQuery.data?.jobs ?? [];

  const workerQuery = useQuery({
    queryKey: ['twitch', 'worker'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/twitch/worker', { signal });
      if (!res.ok) throw new Error('Failed to load the worker');
      return (await res.json()) as WorkerStatus;
    },
    refetchInterval: backoffRefetchInterval(15_000),
    refetchIntervalInBackground: false,
  });
  const worker = workerQuery.data;
  const workerLabel = worker?.online ? 'Online' : worker?.seen ? 'Offline' : 'Not started';

  const updateAvailable = Boolean(worker?.tools && worker.toolLatest && (
    (worker.toolLatest.ytdlp && worker.toolLatest.ytdlp !== worker.tools.ytdlp)
    || (worker.toolLatest.td && worker.toolLatest.td !== worker.tools.td)
  ));
  const updateTools = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/twitch/worker/tools', { method: 'POST' });
      if (!res.ok) throw new Error('Could not ask for an update');
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['twitch', 'worker'] }),
    onError: (error) => toast.error(error.message),
  });

  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'cancel' | 'retry' }) => {
      const res = await fetch(`/api/twitch/jobs/${id}/${action}`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Could not ${action}`);
    },
    onSuccess: () => {
      setCancelling(null);
      void queryClient.invalidateQueries({ queryKey: ['twitch', 'jobs'] });
    },
    onError: (error) => toast.error(error.message),
  });

  const grouped: Record<(typeof SECTIONS)[number]['id'], Job[]> = {
    active: jobs.filter((job) => ACTIVE.has(job.state)),
    waiting: jobs.filter((job) => WAITING.has(job.state)),
    failed: jobs.filter((job) => job.state === 'FAILED'),
    done: jobs.filter((job) => job.state === 'DONE').slice(0, DONE_SHOWN),
  };
  const shown = SECTIONS.filter((item) => (!section || section === item.id) && grouped[item.id].length > 0);
  const updateLabel = worker?.toolUpdatePending ? 'Updating…' : updateAvailable ? 'Update' : 'Try again';

  return (
    <div className="space-y-3 animate-content-in">
      <PullToRefresh onRefresh={refresh} />
      <h1 className="sr-only">Queue</h1>
      <TwitchToolbar
        active="queue"
        actions={(
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={toolbarButtonClass()} aria-label={`Filter: ${SECTIONS.find((item) => item.id === section)?.label ?? 'All'}`}>
                  <Filter className="h-5 w-5" />
                  <FilterDot active={Boolean(section)} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuLabel>Filter</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={!section} onCheckedChange={() => setSection('')}>All</DropdownMenuCheckboxItem>
                {SECTIONS.map((item) => (
                  <DropdownMenuCheckboxItem key={item.id} checked={section === item.id} onCheckedChange={() => setSection(item.id)}>
                    {item.label} ({grouped[item.id].length})
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <ToolbarButton label="Refresh" disabled={jobsQuery.isRefetching} onClick={() => void refresh()}>
              <RefreshCw className={`h-5 w-5 ${jobsQuery.isRefetching ? 'animate-spin' : ''}`} />
            </ToolbarButton>
          </>
        )}
        trailing={canDownload ? (
          <ToolbarButton label="Download a video" href="/twitch/queue/add" filled>
            <Plus className="h-5 w-5" />
          </ToolbarButton>
        ) : undefined}
      >
        <button
          type="button"
          onClick={() => setWorkerOpen(true)}
          className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm hover:bg-accent active:bg-accent/80"
        >
          <span className={cn('h-2 w-2 shrink-0 rounded-full', worker?.online ? 'bg-green-500' : 'bg-red-500')} />
          <span className="shrink-0">{worker ? workerLabel : 'Worker'}</span>
          {worker?.diskFreeBytes != null && (
            <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">{diskSize(worker.diskFreeBytes)} free</span>
          )}
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </TwitchToolbar>

      {worker?.toolsPaused && (
        <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1">Downloads are paused: several failed the same way.</p>
          {canManage && (
            <Button variant="ghost" size="sm" disabled={worker.toolUpdatePending || updateTools.isPending} onClick={() => updateTools.mutate()}>
              {updateLabel}
            </Button>
          )}
        </div>
      )}

      {jobsQuery.isLoading ? (
        <ListSkeleton count={5} />
      ) : jobsQuery.isError ? (
        <ErrorState message="Couldn't load the queue" onRetry={() => void jobsQuery.refetch()} />
      ) : shown.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
          <p>{section ? 'Nothing here.' : 'The queue is empty.'}</p>
        </div>
      ) : (
        shown.map((item) => (
          <GroupedSection key={item.id} title={item.label} className="mb-3">
            <div className="divide-y divide-border/50 overflow-hidden rounded-xl">
              {grouped[item.id].map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  onCancel={(item.id === 'active' || item.id === 'waiting') && canCancel(job) ? () => setCancelling(job) : undefined}
                  onRetry={item.id === 'failed' && canRetry(job) ? () => act.mutate({ id: job.id, action: 'retry' }) : undefined}
                />
              ))}
            </div>
          </GroupedSection>
        ))
      )}

      <Drawer open={workerOpen} onOpenChange={setWorkerOpen}>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>Download worker</DrawerTitle></DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
            <div className="grouped-section-content overflow-hidden">
              <WorkerRow label="Status" value={workerLabel} tone={worker?.online ? 'text-green-400' : 'text-red-400'} />
              {worker?.diskFreeBytes != null && <WorkerRow label="Free on the library disk" value={diskSize(worker.diskFreeBytes)} />}
              {worker?.tools?.ytdlp && <WorkerRow label="yt-dlp" value={worker.tools.ytdlp} />}
              {worker?.tools?.td && <WorkerRow label="TwitchDownloader" value={worker.tools.td} />}
              {worker?.seen && <WorkerRow label="Graphics" value={worker.gpuAvailable ? 'Intel GPU ready' : 'No GPU'} />}
              {worker?.reencodeWindow && (
                <WorkerRow label="Re-encode" value={worker.reencodeWindow.open ? 'Window open' : `From ${worker.reencodeWindow.start}`} />
              )}
              {canManage && (
                <Link href="/settings/twitch" className="grouped-row gap-3 active:bg-foreground/5">
                  <span className="text-sm">Twitch settings</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              )}
            </div>
          </div>
          {canManage && updateAvailable && (
            <DrawerFooter>
              <Button className="w-full" disabled={worker?.toolUpdatePending || updateTools.isPending} onClick={() => updateTools.mutate()}>
                {worker?.toolUpdatePending ? 'Updating…' : 'Update the tools'}
              </Button>
            </DrawerFooter>
          )}
        </DrawerContent>
      </Drawer>

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => { if (!open) setCancelling(null); }}
        title="Cancel this download?"
        description={cancelling?.video?.title}
        confirmLabel="Cancel download"
        cancelLabel="Keep"
        destructive
        busy={act.isPending}
        onConfirm={() => { if (cancelling) act.mutate({ id: cancelling.id, action: 'cancel' }); }}
      />
    </div>
  );
}
