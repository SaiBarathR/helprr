'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { GroupedSection } from '@/components/settings/grouped-section';
import { pollCommandAt } from '@/lib/arr-command';
import { ensureArray, jsonFetcher, withInstanceQuery } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { invalidateMovies, invalidateSeries } from '@/lib/query-invalidation';
import { formatDistanceToNowShort } from '@/lib/format';
import { formatDateTime } from '@/lib/date-format';
import { cn } from '@/lib/utils';
import type { ArrLogEntry, ArrLogLevel, ArrLogPage, ArrSystemStatus, ArrSystemTask } from '@/lib/arr-system';

export type SystemService = 'sonarr' | 'radarr' | 'lidarr' | 'prowlarr';

/** One instance's version and offered update, for its Service status row and sheet (admins only). */
export function arrSystemStatusQuery(instanceId: string) {
  return {
    queryKey: queryKeys.arrSystem('status', instanceId),
    queryFn: jsonFetcher<ArrSystemStatus>('/api/admin/arr-system/status', instanceId),
    staleTime: 5 * 60_000,
  };
}

/** "v4.0.20.3014", or "v3.0.2.5780 · update available (v3.1.0.5799)". */
export function versionSummary(status: ArrSystemStatus | undefined): string {
  if (!status?.version) return '';
  return status.updateVersion
    ? `v${status.version} · update available (v${status.updateVersion})`
    : `v${status.version}`;
}

/** "Every 15 min", "Every 6 hours", "Every 7 days". */
function intervalLabel(minutes: number): string {
  if (minutes <= 0) return 'Manual';
  if (minutes < 60) return `Every ${minutes} min`;
  if (minutes % 1440 === 0) return minutes === 1440 ? 'Daily' : `Every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? 'Hourly' : `Every ${minutes / 60} hours`;
  return `Every ${Math.round(minutes / 6) / 10} hours`;
}

function durationLabel(seconds: number): string {
  if (seconds < 1) return '<1 s';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  return `${Math.round(seconds / 60)} min`;
}

function taskDetail(task: ArrSystemTask): string {
  const parts = [intervalLabel(task.intervalMinutes)];
  if (task.lastExecution) {
    const took = task.lastDurationSeconds !== null ? `, took ${durationLabel(task.lastDurationSeconds)}` : '';
    parts.push(`ran ${formatDistanceToNowShort(task.lastExecution)}${took}`);
  }
  if (task.nextExecution) parts.push(`next ${formatDistanceToNowShort(task.nextExecution)}`);
  return parts.join(' · ');
}

/** A refresh reloads titles, so its completion also reloads the library lists. */
const REFRESHES: Partial<Record<string, (client: ReturnType<typeof useQueryClient>) => void>> = {
  RefreshSeries: invalidateSeries,
  RefreshMovie: invalidateMovies,
  RefreshCollections: invalidateMovies,
};

/** System → Tasks of one instance, with Run now for the tasks the server allows. */
export function ArrTasksPanel({ instanceId }: { instanceId: string }) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set());
  const query = useQuery({
    queryKey: queryKeys.arrSystem('tasks', instanceId),
    queryFn: jsonFetcher<ArrSystemTask[]>('/api/admin/arr-system/tasks', instanceId),
    select: ensureArray<ArrSystemTask>,
    staleTime: 30_000,
  });

  const setTask = (name: string, on: boolean) => setRunning((prev) => {
    const next = new Set(prev);
    if (on) next.add(name);
    else next.delete(name);
    return next;
  });

  async function run(task: ArrSystemTask) {
    setTask(task.taskName, true);
    try {
      const res = await fetch(withInstanceQuery('/api/admin/arr-system/tasks', instanceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: task.taskName }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(`${task.name} failed`, { description: data?.error });
        return;
      }
      const started = (await res.json()) as { id?: number };
      toast.success(`${task.name} started`);
      const status = started.id
        ? await pollCommandAt(withInstanceQuery(`/api/admin/arr-system/tasks/${started.id}`, instanceId))
        : 'completed';
      if (status === 'completed') {
        REFRESHES[task.taskName]?.(queryClient);
        toast.success(`${task.name} finished`);
      } else if (status === 'timeout') {
        toast(`${task.name} is still running`, { description: 'The app carries on with it.' });
      } else {
        toast.error(`${task.name} failed`);
      }
    } catch {
      toast.error(`${task.name} failed`);
    } finally {
      setTask(task.taskName, false);
      void query.refetch();
    }
  }

  if (query.isLoading) return <PanelLoading />;
  if (query.isError) return <PanelMessage>Could not read its tasks. It may be offline.</PanelMessage>;
  const tasks = query.data ?? [];
  if (tasks.length === 0) return <PanelMessage>No scheduled tasks.</PanelMessage>;
  return (
    <GroupedSection
      className="mb-2"
      footer="Run now is offered for tasks that can't install updates or delete files. The others run on their schedule."
    >
      {tasks.map((task) => (
        <div key={task.taskName} className="grouped-row items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{task.name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{taskDetail(task)}</div>
          </div>
          {task.canRun && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={running.has(task.taskName)}
              aria-label={`Run ${task.name} now`}
              onClick={() => void run(task)}
            >
              {running.has(task.taskName) ? <Loader2 className="animate-spin" /> : <Play />}
              Run
            </Button>
          )}
        </div>
      ))}
    </GroupedSection>
  );
}

const LEVEL_STYLE: Record<string, string> = {
  fatal: 'text-rose-400 light:text-rose-600',
  error: 'text-rose-400 light:text-rose-600',
  warn: 'text-amber-400 light:text-amber-700',
};
const LEVEL_LABEL: Record<string, string> = { fatal: 'Fatal', error: 'Error', warn: 'Warning' };

function LogEntryRow({ entry }: { entry: ArrLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const long = entry.message.length > 240 || entry.exception !== '';
  return (
    <div className="grouped-row grouped-row-stacked gap-1">
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        <span className={cn('font-medium', LEVEL_STYLE[entry.level] ?? 'text-muted-foreground')}>
          {LEVEL_LABEL[entry.level] ?? entry.level}
        </span>
        {entry.logger && <span className="min-w-0 truncate text-muted-foreground">· {entry.logger}</span>}
        <time
          dateTime={entry.time}
          title={formatDateTime(entry.time)}
          className="ml-auto shrink-0 text-muted-foreground"
        >
          {formatDistanceToNowShort(entry.time)}
        </time>
      </div>
      <p className={cn('text-sm [overflow-wrap:anywhere]', !expanded && 'line-clamp-4')}>{entry.message}</p>
      {expanded && entry.exception && (
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
          {entry.exception}
        </pre>
      )}
      {long && (
        <button
          type="button"
          className="-my-2 inline-flex min-h-[44px] items-center self-start text-sm text-primary hover:underline"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : entry.exception ? 'Show more and the exception' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/** System → Logs of one instance: warnings and errors (or errors only), newest first. */
export function ArrLogsPanel({ instanceId }: { instanceId: string }) {
  const [level, setLevel] = useState<ArrLogLevel>('warn');
  const query = useInfiniteQuery({
    queryKey: queryKeys.arrSystem('logs', instanceId, level),
    queryFn: ({ pageParam, signal }) =>
      jsonFetcher<ArrLogPage>(`/api/admin/arr-system/logs?level=${level}&page=${pageParam}`, instanceId)({ signal }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.entries.length > 0 && last.page * last.pageSize < last.totalRecords ? last.page + 1 : undefined,
    staleTime: 30_000,
  });
  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];
  const total = query.data?.pages[0]?.totalRecords ?? 0;

  return (
    <>
      <GroupedSection className="mb-4">
        <div className="grouped-row items-center">
          <div className="min-w-0 flex-1 pr-3">
            <div className="text-sm font-medium">Errors only</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {query.isSuccess
                ? `${total.toLocaleString()} ${level === 'error' ? 'error' : 'warning and error'} ${total === 1 ? 'entry' : 'entries'}`
                : 'Off shows warnings too.'}
            </div>
          </div>
          <Switch
            aria-label="Errors only"
            checked={level === 'error'}
            onCheckedChange={(on) => setLevel(on ? 'error' : 'warn')}
          />
        </div>
      </GroupedSection>
      {query.isLoading ? (
        <PanelLoading />
      ) : query.isError ? (
        <PanelMessage>Could not read its log. It may be offline.</PanelMessage>
      ) : entries.length === 0 ? (
        <PanelMessage>{level === 'error' ? 'No errors logged.' : 'No warnings or errors logged.'}</PanelMessage>
      ) : (
        <GroupedSection
          className="mb-2"
          footer="Addresses are cut to their host, and keys, passwords and magnet links are removed."
        >
          {entries.map((entry) => <LogEntryRow key={entry.id} entry={entry} />)}
          {query.hasNextPage && (
            <div className="grouped-row justify-center">
              <Button
                variant="ghost"
                size="sm"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage && <Loader2 className="animate-spin" />}
                Load more
              </Button>
            </div>
          )}
        </GroupedSection>
      )}
    </>
  );
}

function PanelLoading() {
  return (
    <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Loading…
    </div>
  );
}

function PanelMessage({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}
