'use client';

import { useMemo } from 'react';
import type { PlaybackBreakdownEntry, PlayActivityUser } from '@/types/jellyfin';
import { formatDurationSeconds } from '@/lib/jellyfin-helpers';

export type SortMode = 'plays' | 'duration';

const USER_COLORS = [
  'var(--hpr-cyan)',
  'var(--hpr-amber)',
  'var(--hpr-green)',
  'var(--hpr-rose)',
  'var(--hpr-violet)',
  'var(--hpr-pink)',
];

// ─── Ranked list (top TV/movies/clients/devices) ───

export function RankedList({
  entries,
  sortBy,
  maxVisible,
}: {
  entries: PlaybackBreakdownEntry[];
  sortBy: SortMode;
  maxVisible: number;
}) {
  const sorted = useMemo(() => {
    return [...entries]
      .map((e) => ({ ...e, count: Number(e.count) || 0, time: Number(e.time) || 0 }))
      .sort((a, b) => (sortBy === 'duration' ? b.time - a.time : b.count - a.count))
      .slice(0, Math.max(1, maxVisible));
  }, [entries, sortBy, maxVisible]);

  const maxVal = Math.max(...sorted.map((e) => (sortBy === 'duration' ? e.time : e.count)), 1);

  return (
    <div className="rounded-xl bg-card overflow-hidden divide-y divide-border/50 h-full flex flex-col">
      {sorted.map((entry, i) => (
        <div key={`${entry.label}-${i}`} className="relative px-3 flex items-center gap-3 flex-1 min-h-0 @max-[279px]/cell:px-2 @max-[279px]/cell:gap-2">
          <div
            className="absolute inset-0 bg-[var(--hpr-cyan)]/5"
            style={{ width: `${((sortBy === 'duration' ? entry.time : entry.count) / maxVal) * 100}%` }}
          />
          {/* Rank is decoration — dropped on tiny cells so the title keeps readable width. */}
          <span className="text-xs text-muted-foreground font-mono w-5 shrink-0 relative @max-[179px]/cell:hidden">{i + 1}</span>
          <span className="text-sm truncate flex-1 relative">{entry.label}</span>
          <div className="text-right shrink-0 relative">
            <span className="text-xs font-medium tabular-nums">
              {sortBy === 'duration' ? formatDurationSeconds(entry.time) : `${entry.count} plays`}
            </span>
            {/* Secondary metric goes on compact cells — the title gets the room. */}
            <p className="text-[10px] text-muted-foreground @max-[279px]/cell:hidden">
              {sortBy === 'duration' ? `${entry.count} plays` : entry.time > 0 ? formatDurationSeconds(entry.time) : ''}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Playback method bar ───

export function PlaybackMethodBar({
  entries,
  sortBy,
  maxVisible,
}: {
  entries: PlaybackBreakdownEntry[];
  sortBy: SortMode;
  maxVisible: number;
}) {
  const normalized = entries
    .map((e) => ({ ...e, count: Number(e.count) || 0, time: Number(e.time) || 0 }))
    .sort((a, b) => (sortBy === 'duration' ? b.time - a.time : b.count - a.count));
  const total = normalized.reduce((sum, e) => sum + (sortBy === 'duration' ? e.time : e.count), 0) || 1;
  const visible = normalized.slice(0, Math.max(1, maxVisible));

  function getColor(label: string) {
    const m = label.toLowerCase();
    if (m.startsWith('directplay')) return { bar: 'bg-green-500', dot: 'bg-green-500' };
    if (m.startsWith('directstream')) return { bar: 'bg-blue-500', dot: 'bg-blue-500' };
    if (m.startsWith('transcode')) return { bar: 'bg-orange-500', dot: 'bg-orange-500' };
    return { bar: 'bg-muted', dot: 'bg-muted' };
  }

  return (
    <div className="rounded-xl bg-card p-3 px-2 flex flex-col gap-3 h-full overflow-hidden">
      <div className="flex h-5 rounded-full overflow-hidden shrink-0">
        {normalized.map((e) => {
          const metric = sortBy === 'duration' ? e.time : e.count;
          const pct = (metric / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={e.label}
              className={`${getColor(e.label).bar} transition-all`}
              style={{ width: `${pct}%` }}
              title={`${e.label}: ${pct.toFixed(1)}%`}
            />
          );
        })}
      </div>
      <div className="flex-1 min-h-0 flex flex-col gap-1 overflow-hidden">
        {visible.map((e) => {
          const metric = sortBy === 'duration' ? e.time : e.count;
          const pct = ((metric / total) * 100).toFixed(1);
          const colors = getColor(e.label);
          return (
            <div key={e.label} className="flex items-center gap-1 min-h-0">
              <div className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
              <span className="text-xs truncate flex-1">{e.label}</span>
              <span className="text-[11px] font-medium tabular-nums shrink-0">
                {sortBy === 'duration' ? formatDurationSeconds(e.time) : e.count}
              </span>
              <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right shrink-0">{pct}%</span>
              {/* Secondary metric goes on compact cells — label + primary metric keep the room. */}
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 @max-[259px]/cell:hidden">
                {sortBy === 'duration' ? `${e.count} plays` : formatDurationSeconds(e.time)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Play activity chart ───

export function PlayActivityChart({ data, width = 0 }: { data: PlayActivityUser[]; width?: number }) {
  const chartData = useMemo(() => {
    const realUsers = data.filter((u) => u.user_id !== 'labels_user');
    if (realUsers.length === 0) return null;

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

    const nonZeroCount = nonZeroEntries.length;
    let aggregated: [string, number][];
    let periodLabel: string;

    if (nonZeroCount <= 30) {
      aggregated = nonZeroEntries;
      periodLabel = 'daily';
    } else if (nonZeroCount <= 365) {
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
      const months: Record<string, number> = {};
      for (const [date, count] of nonZeroEntries) {
        const monthKey = date.substring(0, 7);
        months[monthKey] = (months[monthKey] || 0) + count;
      }
      aggregated = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
      periodLabel = 'monthly';
    }

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

    const firstDate = new Date(nonZeroEntries[0][0] + 'T12:00:00');
    const lastDate = new Date(nonZeroEntries[nonZeroEntries.length - 1][0] + 'T12:00:00');
    const actualDays = Math.max(1, Math.round((lastDate.getTime() - firstDate.getTime()) / 86400000) + 1);
    const avgPerDay = (totalPlays / actualDays).toFixed(1);

    const labelInterval = Math.max(1, Math.ceil(aggregated.length / 7));
    const isMonthly = periodLabel === 'monthly';

    let userBars: Record<string, number[]> | null = null;
    if (realUsers.length > 1) {
      userBars = {};
      if (periodLabel === 'daily') {
        for (const [label] of aggregated) {
          userBars[label] = realUsers.map((u) => Number(u.user_usage[label]) || 0);
        }
      } else if (periodLabel === 'weekly') {
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
            realUsers.forEach((u, i) => {
              userBars![wl][i] += Number(u.user_usage[date]) || 0;
            });
          }
        }
      } else {
        for (const [label] of aggregated) userBars[label] = realUsers.map(() => 0);
        for (const [date] of nonZeroEntries) {
          const mk = date.substring(0, 7);
          if (userBars[mk]) {
            realUsers.forEach((u, i) => {
              userBars![mk][i] += Number(u.user_usage[date]) || 0;
            });
          }
        }
      }
    }

    return { realUsers, aggregated, totalPlays, maxVal, avgPerDay, periodLabel, labelInterval, userBars, isMonthly };
  }, [data]);

  if (!chartData) return null;
  const { realUsers, aggregated, totalPlays, maxVal, avgPerDay, periodLabel, labelInterval, userBars, isMonthly } =
    chartData;

  // Fit axis labels to the measured width (~48px per "Jun 12" label) so they
  // never overlap on narrow cells; falls back to the count-based interval.
  const effectiveInterval = width > 0
    ? Math.max(1, Math.ceil(aggregated.length / Math.max(2, Math.floor(width / 48))))
    : labelInterval;

  return (
    <div className="rounded-xl bg-card p-3 h-full flex flex-col overflow-hidden">
      <div className="flex items-baseline gap-3 shrink-0">
        <span className="text-lg font-bold tabular-nums">{totalPlays}</span>
        <span className="text-xs text-muted-foreground">total plays</span>
        <span className="text-xs text-muted-foreground ml-auto">~{avgPerDay}/day avg</span>
      </div>

      {realUsers.length > 1 && (
        <div className="flex items-center gap-3 mt-2 flex-wrap shrink-0">
          {realUsers.map((u, i) => (
            <div key={u.user_id} className="flex items-center gap-1 text-[10px]">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: USER_COLORS[i % USER_COLORS.length] }}
              />
              <span className="text-muted-foreground">{u.user_name}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-[2px] flex-1 min-h-0 mt-3">
        {aggregated.map(([label, count]) => {
          const pct = (count / maxVal) * 100;
          if (userBars && userBars[label]) {
            const userValues = userBars[label];
            const userTotal = userValues.reduce((s, v) => s + v, 0) || 1;
            return (
              <div
                key={label}
                className="flex-1 flex flex-col items-center justify-end h-full min-w-0"
                title={`${label}: ${count}`}
              >
                <div
                  className="w-full rounded-t-sm overflow-hidden min-h-[2px] flex flex-col-reverse"
                  style={{ height: `${Math.max(pct, 2)}%` }}
                >
                  {userValues.map((val, i) => {
                    if (val === 0) return null;
                    return (
                      <div
                        key={i}
                        style={{
                          height: `${(val / userTotal) * 100}%`,
                          backgroundColor: USER_COLORS[i % USER_COLORS.length],
                          minHeight: 1,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          }
          return (
            <div
              key={label}
              className="flex-1 flex flex-col items-center justify-end h-full min-w-0"
              title={`${label}: ${count}`}
            >
              <div
                className="w-full rounded-t-sm bg-[var(--hpr-cyan)] min-h-[2px]"
                style={{ height: `${Math.max(pct, 2)}%` }}
              />
            </div>
          );
        })}
      </div>

      <div className="flex gap-[2px] mt-1 shrink-0">
        {aggregated.map(([label], i) => (
          <div key={label} className="flex-1 text-center min-w-0 overflow-hidden">
            {i % effectiveInterval === 0 || i === aggregated.length - 1 ? (
              <span className="text-[8px] text-muted-foreground whitespace-nowrap">
                {isMonthly
                  ? new Date(label + '-15').toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
                  : new Date(label + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground mt-1 text-center shrink-0">{periodLabel} view</p>
    </div>
  );
}

// ─── Hourly heatmap ───

export function HourlyHeatmap({ data }: { data: Record<string, number> }) {
  const values = Object.values(data).filter((v) => v > 0);
  const maxVal = Math.max(...values, 1);
  const totalSecs = values.reduce((s, v) => s + v, 0);
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  let peakDay = 0;
  let peakHour = 0;
  let peakVal = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const key = `${d}-${String(h).padStart(2, '0')}`;
      const v = data[key] || 0;
      if (v > peakVal) {
        peakVal = v;
        peakDay = d;
        peakHour = h;
      }
    }
  }

  return (
    <div className="rounded-xl bg-card p-3 flex flex-col gap-2 h-full overflow-hidden">
      {/* Wraps on narrow cells instead of the two stats colliding. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-[11px] text-muted-foreground shrink-0">
        <span>Total: {formatDurationSeconds(totalSecs)}</span>
        {peakVal > 0 && (
          <span>
            Peak: {dayLabels[peakDay]} {peakHour}:00
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex ml-8 mb-0.5 shrink-0">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="flex-1 text-center text-[7px] text-muted-foreground">
              {h % 4 === 0 ? `${h}` : ''}
            </div>
          ))}
        </div>
        <div className="flex-1 min-h-0 flex flex-col gap-[2px]">
          {dayLabels.map((day, dayIdx) => (
            <div key={day} className="flex items-center gap-1 flex-1 min-h-0">
              <span className="text-[8px] text-muted-foreground w-7 shrink-0 text-right">{day}</span>
              <div className="flex-1 flex gap-[1px] h-full">
                {Array.from({ length: 24 }, (_, h) => {
                  const key = `${dayIdx}-${String(h).padStart(2, '0')}`;
                  const val = data[key] || 0;
                  const intensity = val / maxVal;
                  return (
                    <div
                      key={h}
                      className="flex-1 rounded-[2px] h-full"
                      style={{
                        backgroundColor:
                          intensity > 0
                            ? `color-mix(in oklab, var(--hpr-cyan) ${(0.12 + intensity * 0.88) * 100}%, transparent)`
                            : 'color-mix(in oklab, var(--hpr-fg) 3%, transparent)',
                      }}
                      title={`${day} ${h}:00 — ${formatDurationSeconds(val)}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-1 shrink-0">
        <span className="text-[8px] text-muted-foreground mr-0.5">Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((i) => (
          <div
            key={i}
            className="w-3 h-3 rounded-[2px]"
            style={{
              backgroundColor:
                i === 0
                  ? 'color-mix(in oklab, var(--hpr-fg) 3%, transparent)'
                  : `color-mix(in oklab, var(--hpr-cyan) ${(0.12 + i * 0.88) * 100}%, transparent)`,
            }}
          />
        ))}
        <span className="text-[8px] text-muted-foreground ml-0.5">More</span>
      </div>
    </div>
  );
}
