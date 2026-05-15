'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { formatDistanceToNowShort } from '@/lib/format';
import { formatDelta } from '@/lib/cleanup/format-delta';
import { SectionHeader } from '@/components/widgets/shared';
import type { WidgetProps } from '@/lib/widgets/types';
import type { AutoRunMode } from '@/lib/cleanup/types';

interface SchedulerLeg {
  autoRunMode: AutoRunMode;
  intervalMinutes: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  running: boolean;
}

interface SchedulerStatus {
  queue: SchedulerLeg;
  download: SchedulerLeg;
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

interface CleanupStats {
  removedToday: number;
  removedThisWeek: number;
  removedAllTime: number;
  activeStrikes: number;
  totalStrikes: number;
  reSearchedAllTime: number;
}

interface CleanupStatusData {
  scheduler: SchedulerStatus | null;
  strikes: StrikeRow[];
  stats: CleanupStats | null;
}

async function fetchCleanupStatus(): Promise<CleanupStatusData> {
  const [schedulerRes, strikesRes, statsRes] = await Promise.all([
    fetch('/api/cleanup/scheduler-status'),
    fetch('/api/cleanup/strikes'),
    fetch('/api/cleanup/stats'),
  ]);
  const scheduler: SchedulerStatus | null = schedulerRes.ok
    ? ((await schedulerRes.json()) as SchedulerStatus)
    : null;
  const strikes: StrikeRow[] = strikesRes.ok
    ? ((await strikesRes.json()) as StrikeRow[])
    : [];
  const stats: CleanupStats | null = statsRes.ok
    ? ((await statsRes.json()) as CleanupStats)
    : null;
  return { scheduler, strikes, stats };
}

export function CleanupStatusWidget({ size, refreshInterval }: WidgetProps) {
  const { data, loading } = useWidgetData({
    fetchFn: fetchCleanupStatus,
    refreshInterval,
  });

  // Independent 1s tick so countdowns flow smoothly between the slower
  // `useWidgetData` polls.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <div>
        <SectionHeader title="Cleanup" href="/cleanup" />
        <div className="space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
          </div>
          <Skeleton className="h-3 w-24 mt-3" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  const queue = data?.scheduler?.queue;
  const download = data?.scheduler?.download;
  const strikes = data?.strikes ?? [];
  const stats = data?.stats;
  const strikeLimit = size === 'large' ? 8 : 3;

  return (
    <div>
      <SectionHeader title="Cleanup" href="/cleanup" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <StatTile label="Today" value={stats?.removedToday} />
        <StatTile label="Past 7 days" value={stats?.removedThisWeek} />
        <StatTile label="Total strikes" value={stats?.totalStrikes} />
        <StatTile label="Re-searches" value={stats?.reSearchedAllTime} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <CleanerStatusRow label="Queue" leg={queue} now={now} />
        <CleanerStatusRow label="Download" leg={download} now={now} />
      </div>

      <div className="mt-4 mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          Active strikes ({strikes.length})
        </span>
      </div>

      {strikes.length === 0 ? (
        <div className="rounded-xl bg-card py-4 text-center">
          <p className="text-xs text-muted-foreground">No active strikes</p>
        </div>
      ) : (
        <div className="space-y-1">
          {strikes.slice(0, strikeLimit).map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{s.torrentName}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {s.strikeType}
                  {s.ruleName ? ` · ${s.ruleName}` : ''}
                  {' · '}
                  {formatDistanceToNowShort(s.lastSeenAt)}
                </p>
              </div>
              <Badge
                variant={s.count >= s.maxStrikes ? 'destructive' : 'outline'}
                className="shrink-0 font-mono text-[10px] px-1.5"
              >
                {s.count}/{s.maxStrikes}
              </Badge>
            </div>
          ))}
          {strikes.length > strikeLimit && (
            <div className="text-[10px] text-muted-foreground text-center pt-0.5">
              +{strikes.length - strikeLimit} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg bg-card px-2.5 py-1.5">
      <div className="text-lg font-mono font-semibold tabular-nums leading-tight">
        {value ?? '—'}
      </div>
      <div className="text-[10px] text-muted-foreground truncate">{label}</div>
    </div>
  );
}

function CleanerStatusRow({
  label,
  leg,
  now,
}: {
  label: string;
  leg: SchedulerLeg | undefined;
  now: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-card px-3 py-2">
      <span className="text-xs font-medium truncate">{label}</span>
      <StatusPill leg={leg} now={now} />
    </div>
  );
}

function StatusPill({ leg, now }: { leg: SchedulerLeg | undefined; now: number }) {
  if (!leg) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  if (leg.autoRunMode === 'disabled') {
    return (
      <Badge variant="outline" className="text-[10px] font-mono px-1.5">
        Off
      </Badge>
    );
  }
  if (leg.running) {
    return (
      <Badge
        variant="secondary"
        className="text-[10px] font-mono px-1.5 bg-amber-500/15 text-amber-400 animate-pulse"
      >
        Running…
      </Badge>
    );
  }
  if (leg.nextRunAt == null) {
    return (
      <Badge variant="outline" className="text-[10px] font-mono px-1.5">
        Idle
      </Badge>
    );
  }
  const delta = leg.nextRunAt - now;
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <Badge variant="secondary" className="text-[10px] font-mono px-1.5 whitespace-nowrap">
        {formatDelta(delta)}
      </Badge>
      {leg.autoRunMode === 'dryRun' && (
        <span className="text-[9px] text-muted-foreground uppercase tracking-wide">dry</span>
      )}
    </div>
  );
}
