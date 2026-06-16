'use client';
import { ApiError } from '@/lib/query-fetch';

import { useCallback, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Timer,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { JellyfinScheduledTask } from '@/types/jellyfin';
import type { WidgetProps } from '@/lib/widgets/types';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { formatTriggerSchedule, taskRunDuration, timeAgo } from '@/lib/jellyfin-helpers';
import { SectionHeader, HPR } from './bento-primitives';

async function fetchTasks(): Promise<JellyfinScheduledTask[]> {
  const res = await fetch('/api/jellyfin/tasks');
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  const data = await res.json();
  return Array.isArray(data.tasks) ? data.tasks : [];
}

function TaskStatusIcon({ status, state }: { status?: string; state: string }) {
  if (state === 'Running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--hpr-cyan)] shrink-0" />;
  if (state === 'Cancelling') return <XCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
  if (status === 'Completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
  if (status === 'Failed' || status === 'Aborted') return <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
  return <Clock className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />;
}

export function JellyfinScheduledTasksWidget({ refreshInterval, editMode = false }: WidgetProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [busyTasks, setBusyTasks] = useState<Set<string>>(new Set());
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const { data, loading, refresh } = useWidgetData<JellyfinScheduledTask[]>({
    fetchFn: fetchTasks,
    refreshInterval,
    enabled: !editMode,
    // Stable key — a task action refetches via the hook's refresh() rather than
    // bumping a counter into the key, which orphaned the previous cache slot.
    cacheKey: 'jellyfin-scheduled-tasks',
  });

  const tasks = useMemo(() => data ?? [], [data]);

  const handleTaskAction = useCallback(
    async (taskId: string, action: 'start' | 'stop') => {
      if (editMode) return;
      setBusyTasks((prev) => new Set(prev).add(taskId));
      try {
        const res = await fetch(`/api/jellyfin/tasks/${taskId}`, {
          method: action === 'start' ? 'POST' : 'DELETE',
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          toast.error(body?.error || `Failed to ${action} task`);
          return;
        }
        void refresh();
      } catch {
        toast.error(`Failed to ${action} task`);
      } finally {
        setBusyTasks((prev) => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      }
    },
    [editMode, refresh],
  );

  const visible = useMemo(() => tasks.filter((t) => !t.IsHidden), [tasks]);
  const active = useMemo(
    () => visible.filter((t) => t.State === 'Running' || t.State === 'Cancelling'),
    [visible],
  );
  const failed = useMemo(
    () =>
      visible.filter(
        (t) => t.State === 'Idle' && t.LastExecutionResult?.Status && t.LastExecutionResult.Status !== 'Completed',
      ),
    [visible],
  );

  const categories = useMemo(() => {
    const grouped: Record<string, typeof visible> = {};
    for (const t of visible) {
      const cat = t.Category || 'Other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(t);
    }
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

  const totalCount = visible.length;
  const runningCount = active.length;
  const completedCount = visible.filter((t) => t.LastExecutionResult?.Status === 'Completed').length;
  const failedCount = failed.length;

  const badge = runningCount > 0 ? (
    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-[var(--hpr-cyan)]/15 text-[var(--hpr-cyan)]">
      {runningCount} running
    </Badge>
  ) : undefined;

  const right = (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      disabled={manualRefreshing || editMode}
      onClick={() => {
        setManualRefreshing(true);
        void refresh();
        // micro-debounce: refresh() kicks off the refetch but resolves later —
        // release the button after a beat.
        setTimeout(() => setManualRefreshing(false), 600);
      }}
    >
      {manualRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
    </Button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <SectionHeader title="Scheduled Tasks" badge={badge} right={right} />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} className="no-scrollbar">
        {loading && totalCount === 0 ? (
          <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
        ) : totalCount === 0 ? (
          <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>No scheduled tasks.</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1 mb-1">
              <div className="rounded-lg bg-card px-3 py-2 text-center">
                <p className="text-lg font-semibold tabular-nums">{totalCount}</p>
                <p className="text-[10px] text-muted-foreground">Total</p>
              </div>
              <div className="rounded-lg bg-card px-3 py-2 text-center">
                <p className="text-lg font-semibold tabular-nums text-emerald-500">{completedCount}</p>
                <p className="text-[10px] text-muted-foreground">Completed</p>
              </div>
              <div className="rounded-lg bg-card px-3 py-2 text-center">
                <p
                  className={`text-lg font-semibold tabular-nums ${
                    failedCount > 0 ? 'text-red-500' : 'text-muted-foreground/50'
                  }`}
                >
                  {failedCount}
                </p>
                <p className="text-[10px] text-muted-foreground">Failed</p>
              </div>
            </div>

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
                        {t.CurrentProgressPercentage != null
                          ? `${t.CurrentProgressPercentage.toFixed(0)}%`
                          : 'Running'}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                        disabled={editMode || busyTasks.has(t.Id)}
                        onClick={() => handleTaskAction(t.Id, 'stop')}
                      >
                        {busyTasks.has(t.Id) ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Square className="h-3 w-3" />
                        )}
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
                          <span className="text-[10px] text-muted-foreground">
                            {timeAgo(t.LastExecutionResult.EndTimeUtc)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

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
                      type="button"
                      onClick={() => setExpandedCategory(isExpanded ? null : category)}
                      className="w-full px-3 py-2.5 flex items-center gap-2.5 hover:bg-muted/30 transition-colors"
                    >
                      <ChevronRight
                        className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${
                          isExpanded ? 'rotate-90' : ''
                        }`}
                      />
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-sm font-medium">{category}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {catTasks.length} task{catTasks.length !== 1 ? 's' : ''}
                          {catRunning > 0 && <span className="text-[var(--hpr-cyan)]"> · {catRunning} running</span>}
                          {latestRun && <span> · {timeAgo(latestRun)}</span>}
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
                          .slice()
                          .sort((a, b) =>
                            (b.LastExecutionResult?.EndTimeUtc || '').localeCompare(
                              a.LastExecutionResult?.EndTimeUtc || '',
                            ),
                          )
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
                                      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                                        {t.Description}
                                      </p>
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
                                    className={`h-6 w-6 shrink-0 ${
                                      isRunning
                                        ? 'text-red-500 hover:text-red-400 hover:bg-red-500/10'
                                        : 'text-[var(--hpr-cyan)] hover:text-[var(--hpr-cyan)]/80 hover:bg-[var(--hpr-cyan)]/10'
                                    }`}
                                    disabled={editMode || isBusy}
                                    onClick={() => handleTaskAction(t.Id, isRunning ? 'stop' : 'start')}
                                  >
                                    {isBusy ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : isRunning ? (
                                      <Square className="h-3 w-3" />
                                    ) : (
                                      <Play className="h-3 w-3" />
                                    )}
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
          </>
        )}
      </div>
    </div>
  );
}
