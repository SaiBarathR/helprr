'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Loader2, AlertTriangle, Eye, ChevronRight } from 'lucide-react';
import { RunPreviewDialog, QueueDryRunDecision, DownloadDryRunDecision, RunPreviewPendingStrike } from './run-preview-dialog';
import type { AutoRunMode } from '@/lib/cleanup/types';
import { formatDelta } from '@/lib/cleanup/format-delta';
import { jsonOk } from '@/lib/http';
import { PageControls } from '@/components/ui/page-controls';
import { useVisibleInterval } from '@/lib/hooks/use-visible-interval';
import { backoffRefetchInterval } from '@/lib/query-fetch';

const STRIKES_PAGE_SIZE = 30;

interface Stats {
  removedToday: number;
  removedThisWeek: number;
  removedAllTime: number;
  queueTotal: number;
  downloadTotal: number;
  activeStrikes: number;
  totalStrikes: number;
  reSearchedAllTime: number;
}

interface StrikeRow {
  id: string;
  hash: string;
  torrentName: string;
  strikeType: string;
  ruleId: string | null;
  ruleName: string | null;
  count: number;
  maxStrikes: number;
  lastSeenAt: string;
}

interface CleanerStatusLite {
  enabled: boolean;
  autoRunMode: AutoRunMode;
  intervalMinutes: number;
}

interface DashboardStatus {
  queue: CleanerStatusLite;
  download: CleanerStatusLite;
}

interface SchedulerLite {
  autoRunMode: AutoRunMode;
  intervalMinutes: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  running: boolean;
}

interface SchedulerStatusResponse {
  queue: SchedulerLite;
  download: SchedulerLite;
}

export function CleanupDashboardTab({ onNavigate }: { onNavigate: (target: 'queue' | 'download' | 'history') => void }) {
  const [strikePage, setStrikePage] = useState(1);
  const queryClient = useQueryClient();

  const [queuePreview, setQueuePreview] = useState<{
    open: boolean;
    loading: boolean;
    decisions: QueueDryRunDecision[];
    pendingStrikes: RunPreviewPendingStrike[];
    confirming: boolean;
    confirmGate: boolean;
  }>({ open: false, loading: false, decisions: [], pendingStrikes: [], confirming: false, confirmGate: false });

  const [downloadPreview, setDownloadPreview] = useState<{
    open: boolean;
    loading: boolean;
    decisions: DownloadDryRunDecision[];
    confirming: boolean;
    confirmGate: boolean;
  }>({ open: false, loading: false, decisions: [], confirming: false, confirmGate: false });

  // Dashboard stats + strikes + cleaner status, polled every 15s. Keyed by
  // strikePage so a page change auto-refetches (TanStack cancels superseded
  // in-flight requests — replaces the old latest-request-wins guard).
  const dashboardQuery = useQuery({
    queryKey: ['cleanup', 'dashboard', strikePage],
    queryFn: async ({ signal }) => {
      const [statsRes, strikesRes, queueCfg, downloadCfg] = await Promise.all([
        fetch('/api/cleanup/stats', { signal }).then(jsonOk<Stats>),
        fetch(`/api/cleanup/strikes?page=${strikePage}&pageSize=${STRIKES_PAGE_SIZE}`, { signal }).then(
          jsonOk<{ records: StrikeRow[]; total: number }>
        ),
        fetch('/api/cleanup/queue/config', { signal }).then(jsonOk<Record<string, unknown>>),
        fetch('/api/cleanup/download/config', { signal }).then(jsonOk<Record<string, unknown>>),
      ]);
      const status: DashboardStatus = {
        queue: {
          enabled: Boolean(queueCfg?.enabled),
          autoRunMode: (queueCfg?.autoRunMode ?? 'disabled') as AutoRunMode,
          intervalMinutes: Number(queueCfg?.intervalMinutes ?? 0),
        },
        download: {
          enabled: Boolean(downloadCfg?.enabled),
          autoRunMode: (downloadCfg?.autoRunMode ?? 'disabled') as AutoRunMode,
          intervalMinutes: Number(downloadCfg?.intervalMinutes ?? 0),
        },
      };
      return { stats: statsRes, strikes: strikesRes.records, strikeTotal: strikesRes.total, status };
    },
    refetchInterval: backoffRefetchInterval(15000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const stats = dashboardQuery.data?.stats ?? null;
  const strikes = dashboardQuery.data?.strikes ?? [];
  const strikeTotal = dashboardQuery.data?.strikeTotal ?? 0;
  const status = dashboardQuery.data?.status ?? null;
  const loading = dashboardQuery.isLoading;

  const schedulerQuery = useQuery({
    queryKey: ['cleanup', 'scheduler'],
    queryFn: ({ signal }) =>
      fetch('/api/cleanup/scheduler-status', { signal }).then(jsonOk<SchedulerStatusResponse>),
    refetchInterval: backoffRefetchInterval(5000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const scheduler = schedulerQuery.data ?? null;

  // Strikes may have been resolved since the last poll — if the current page is
  // now past the end, clamp back so the list doesn't render blank.
  useEffect(() => {
    const maxStrikePage = Math.max(1, Math.ceil(strikeTotal / STRIKES_PAGE_SIZE));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clamp once when strikes resolve past the current page
    if (strikePage > maxStrikePage) setStrikePage(maxStrikePage);
  }, [strikeTotal, strikePage]);

  useEffect(() => {
    if (dashboardQuery.isError) toast.error('Failed to load dashboard');
  }, [dashboardQuery.isError]);

  const startQueueDryRun = async () => {
    setQueuePreview({ open: true, loading: true, decisions: [], pendingStrikes: [], confirming: false, confirmGate: false });
    try {
      const r = await fetch('/api/cleanup/queue/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      const json = await jsonOk<{ decisions?: QueueDryRunDecision[]; pendingStrikes?: RunPreviewPendingStrike[] }>(r);
      setQueuePreview({
        open: true,
        loading: false,
        decisions: json.decisions ?? [],
        pendingStrikes: json.pendingStrikes ?? [],
        confirming: false,
        confirmGate: false,
      });
    } catch {
      toast.error('Queue dry-run failed');
      setQueuePreview({ open: false, loading: false, decisions: [], pendingStrikes: [], confirming: false, confirmGate: false });
    }
  };

  const executeQueueRun = async () => {
    setQueuePreview((p) => ({ ...p, confirming: true, confirmGate: false }));
    try {
      const r = await fetch('/api/cleanup/queue/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false }),
      });
      const json = await jsonOk<{ succeeded?: number; failed?: number; decisions?: QueueDryRunDecision[] }>(r);
      const succeeded = json.succeeded ?? 0;
      const failed = json.failed ?? 0;
      toast.success(`Removed ${succeeded} torrent(s)${failed > 0 ? ` — ${failed} failed` : ''}`);
      setQueuePreview({ open: false, loading: false, decisions: [], pendingStrikes: [], confirming: false, confirmGate: false });
      void queryClient.invalidateQueries({ queryKey: ['cleanup', 'dashboard'] });
    } catch {
      toast.error('Queue run failed');
      setQueuePreview((p) => ({ ...p, confirming: false }));
    }
  };

  const onConfirmQueue = () => {
    if (queuePreview.decisions.length >= 5) {
      setQueuePreview((p) => ({ ...p, confirmGate: true }));
    } else {
      void executeQueueRun();
    }
  };

  const startDownloadDryRun = async () => {
    setDownloadPreview({ open: true, loading: true, decisions: [], confirming: false, confirmGate: false });
    try {
      const r = await fetch('/api/cleanup/download/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      const json = await jsonOk<{ decisions?: DownloadDryRunDecision[] }>(r);
      setDownloadPreview({
        open: true,
        loading: false,
        decisions: json.decisions ?? [],
        confirming: false,
        confirmGate: false,
      });
    } catch {
      toast.error('Download dry-run failed');
      setDownloadPreview({ open: false, loading: false, decisions: [], confirming: false, confirmGate: false });
    }
  };

  const executeDownloadRun = async () => {
    setDownloadPreview((p) => ({ ...p, confirming: true, confirmGate: false }));
    try {
      const r = await fetch('/api/cleanup/download/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false }),
      });
      const json = await jsonOk<{ succeeded?: number; failed?: number; decisions?: DownloadDryRunDecision[] }>(r);
      const succeeded = json.succeeded ?? 0;
      const failed = json.failed ?? 0;
      toast.success(`Removed ${succeeded} torrent(s)${failed > 0 ? ` — ${failed} failed` : ''}`);
      setDownloadPreview({ open: false, loading: false, decisions: [], confirming: false, confirmGate: false });
      void queryClient.invalidateQueries({ queryKey: ['cleanup', 'dashboard'] });
    } catch {
      toast.error('Download run failed');
      setDownloadPreview((p) => ({ ...p, confirming: false }));
    }
  };

  const onConfirmDownload = () => {
    if (downloadPreview.decisions.length >= 5) {
      setDownloadPreview((p) => ({ ...p, confirmGate: true }));
    } else {
      void executeDownloadRun();
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Removed today" value={stats?.removedToday ?? '—'} loading={loading} />
          <StatCard label="Past 7 days" value={stats?.removedThisWeek ?? '—'} loading={loading} />
          <StatCard label="All time" value={stats?.removedAllTime ?? '—'} loading={loading} />
          <StatCard label="Active strikes" value={stats?.activeStrikes ?? '—'} loading={loading} />
          <StatCard label="Total strikes" value={stats?.totalStrikes ?? '—'} loading={loading} />
          <StatCard label="Re-searches" value={stats?.reSearchedAllTime ?? '—'} loading={loading} />
        </section>

        <section className="grouped-section">
          <div className="grouped-section-title">Auto-run status</div>
          <div className="grouped-section-content">
            <StatusRow
              label="Queue Cleaner"
              status={status?.queue}
              scheduler={scheduler?.queue}
              onConfigure={() => onNavigate('queue')}
            />
            <StatusRow
              label="Download Cleaner"
              status={status?.download}
              scheduler={scheduler?.download}
              onConfigure={() => onNavigate('download')}
            />
          </div>
        </section>

        <section className="grouped-section">
          <div className="grouped-section-title">Manual runs</div>
          <div className="grouped-section-content">
            <div className="grouped-row flex-wrap gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">Queue Cleaner</div>
                <div className="text-xs text-muted-foreground">
                  Preview decisions before applying. Removes files from qBittorrent and (if configured) blocklists in Sonarr/Radarr.
                </div>
              </div>
              <Button size="sm" onClick={startQueueDryRun} className="ml-auto shrink-0">
                <Eye className="w-4 h-4 mr-1" /> Preview
              </Button>
            </div>
            <div className="grouped-row flex-wrap gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">Download Cleaner</div>
                <div className="text-xs text-muted-foreground">
                  Preview seeding rule matches before applying. Removes torrents based on ratio / seed-time policy.
                </div>
              </div>
              <Button size="sm" onClick={startDownloadDryRun} className="ml-auto shrink-0">
                <Eye className="w-4 h-4 mr-1" /> Preview
              </Button>
            </div>
          </div>
        </section>

        <section className="grouped-section">
          <div className="grouped-section-title flex items-center justify-between">
            <span>Active strikes ({strikeTotal})</span>
            {strikes.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onNavigate('history')}
                className="h-7 px-2 text-xs"
              >
                View history <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            )}
          </div>
          <div className="grouped-section-content">
            {loading ? (
              <div className="grouped-row text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
            ) : strikes.length === 0 ? (
              <div className="grouped-row text-sm text-muted-foreground">No strikes currently accumulated.</div>
            ) : (
              strikes.map((s) => (
                <div key={s.id} className="grouped-row">
                  <div className="min-w-0 flex-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="font-medium truncate">{s.torrentName}</div>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="start" className="max-w-md break-all">
                        {s.torrentName}
                      </TooltipContent>
                    </Tooltip>
                    <div className="text-xs text-muted-foreground">
                      {s.strikeType}{s.ruleName ? ` · ${s.ruleName}` : ''} · {new Date(s.lastSeenAt).toLocaleString()}
                    </div>
                  </div>
                  <Badge
                    variant={s.count >= s.maxStrikes ? 'destructive' : 'outline'}
                    className="shrink-0 font-mono"
                  >
                    {s.count}/{s.maxStrikes}
                  </Badge>
                </div>
              ))
            )}
          </div>
          {strikeTotal > STRIKES_PAGE_SIZE && (
            <div className="mt-2">
              <PageControls
                page={strikePage}
                total={strikeTotal}
                pageSize={STRIKES_PAGE_SIZE}
                onPage={setStrikePage}
                loading={loading}
              />
            </div>
          )}
        </section>

        <div className="text-xs text-muted-foreground flex items-start gap-2 px-1">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            Cleaners only act on torrents managed in qBittorrent. Make sure qBittorrent (and optionally Sonarr/Radarr) are configured in Settings before enabling auto-run.
          </span>
        </div>

        <RunPreviewDialog
          cleaner="queue"
          title="Queue Cleaner — dry-run preview"
          open={queuePreview.open}
          onOpenChange={(o) => setQueuePreview((p) => ({ ...p, open: o }))}
          loading={queuePreview.loading}
          decisions={queuePreview.decisions}
          pendingStrikes={queuePreview.pendingStrikes}
          onConfirm={onConfirmQueue}
          confirming={queuePreview.confirming}
        />
        <RunPreviewDialog
          cleaner="download"
          title="Download Cleaner — dry-run preview"
          open={downloadPreview.open}
          onOpenChange={(o) => setDownloadPreview((p) => ({ ...p, open: o }))}
          loading={downloadPreview.loading}
          decisions={downloadPreview.decisions}
          onConfirm={onConfirmDownload}
          confirming={downloadPreview.confirming}
        />

        <ConfirmDialog
          open={queuePreview.confirmGate}
          onOpenChange={(o) => setQueuePreview((p) => ({ ...p, confirmGate: o }))}
          title={`Remove ${queuePreview.decisions.length} torrents?`}
          description="This will remove the torrents listed in the preview from qBittorrent (and blocklist/re-search via Sonarr/Radarr where applicable). This cannot be undone."
          confirmLabel="Yes, remove them"
          cancelLabel="Cancel"
          destructive
          busy={queuePreview.confirming}
          onConfirm={executeQueueRun}
        />
        <ConfirmDialog
          open={downloadPreview.confirmGate}
          onOpenChange={(o) => setDownloadPreview((p) => ({ ...p, confirmGate: o }))}
          title={`Remove ${downloadPreview.decisions.length} torrents?`}
          description="This will remove the seeding torrents listed in the preview. Files may also be deleted according to each rule's setting. This cannot be undone."
          confirmLabel="Yes, remove them"
          cancelLabel="Cancel"
          destructive
          busy={downloadPreview.confirming}
          onConfirm={executeDownloadRun}
        />
      </div>
    </TooltipProvider>
  );
}

function StatCard({ label, value, loading }: { label: string; value: number | string; loading: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-mono">{loading ? '—' : value}</div>
    </div>
  );
}

function StatusRow({
  label,
  status,
  scheduler,
  onConfigure,
}: {
  label: string;
  status: CleanerStatusLite | undefined;
  scheduler: SchedulerLite | undefined;
  onConfigure: () => void;
}) {
  if (!status) {
    return (
      <div className="grouped-row text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading {label}…
      </div>
    );
  }
  const variant = autoRunBadgeVariant(status);
  const description = autoRunDescription(status);
  const showCountdown = status.enabled && status.autoRunMode !== 'disabled';
  return (
    <div className="grouped-row flex-wrap gap-2">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
        {showCountdown && (
          <NextRunLine scheduler={scheduler} />
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <Badge variant={variant.variant} className={variant.className}>{variant.label}</Badge>
        <Button variant="ghost" size="sm" onClick={onConfigure}>Configure</Button>
      </div>
    </div>
  );
}

function NextRunLine({ scheduler }: { scheduler: SchedulerLite | undefined }) {
  const [now, setNow] = useState<number>(() => Date.now());
  // 1s countdown tick — paused while the tab is hidden, resumes on return.
  useVisibleInterval(() => setNow(Date.now()), 1000);

  if (!scheduler) {
    return <div className="text-xs text-muted-foreground/70 mt-0.5">Next run: —</div>;
  }
  if (scheduler.running) {
    return <div className="text-xs text-amber-500 mt-0.5">Cycle running now…</div>;
  }
  if (scheduler.nextRunAt == null) {
    return <div className="text-xs text-muted-foreground/70 mt-0.5">Next run: scheduler idle</div>;
  }
  const deltaMs = scheduler.nextRunAt - now;
  return (
    <div className="text-xs text-muted-foreground mt-0.5">
      Next run in <span className="font-mono">{formatDelta(deltaMs)}</span>
    </div>
  );
}

function autoRunBadgeVariant(s: CleanerStatusLite): { variant: 'default' | 'outline' | 'secondary' | 'destructive'; className?: string; label: string } {
  if (!s.enabled) return { variant: 'outline', label: 'Master toggle off' };
  switch (s.autoRunMode) {
    case 'enabled':
      return { variant: 'default', label: 'Active (real)' };
    case 'dryRun':
      return { variant: 'secondary', label: 'Dry-run only' };
    case 'disabled':
    default:
      return { variant: 'outline', label: 'Auto-run off' };
  }
}

function autoRunDescription(s: CleanerStatusLite): string {
  if (!s.enabled) return 'The master toggle for this cleaner is off. No cycles will run.';
  switch (s.autoRunMode) {
    case 'enabled':
      return `Auto-running every ${s.intervalMinutes} min — real deletions.`;
    case 'dryRun':
      return `Auto-running every ${s.intervalMinutes} min — logs only, no deletions.`;
    case 'disabled':
    default:
      return 'Master toggle is on but auto-run is off. Use the manual preview below to run on demand.';
  }
}
