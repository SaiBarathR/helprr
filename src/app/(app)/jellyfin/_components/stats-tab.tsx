'use client';

import { useRouteViewState } from '@/lib/hooks/use-route-view-state';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { PageSpinner } from '@/components/ui/page-spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowUpDown } from 'lucide-react';
import type { PlaybackBreakdownEntry, PlayActivityUser } from '@/types/jellyfin';
import { formatDurationSeconds } from '@/lib/jellyfin-helpers';
import { MAX_DAYS, PluginNotice, SectionHeader, ServerErrorState } from './shared';

const DAY_RANGES = [1, 3, 7, 14, 30, 90, 0]; // 0 = All Time

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tab 4: STATS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type SortMode = 'plays' | 'duration';

export function StatsTab() {
  const [days, setDays] = useRouteViewState('StatsTab:days', 3);
  const [selectedUserId, setSelectedUserId] = useRouteViewState('StatsTab:selectedUserId', '');
  const [methodSort, setMethodSort] = useRouteViewState<SortMode>('StatsTab:methodSort', 'duration');
  const [tvSort, setTvSort] = useRouteViewState<SortMode>('StatsTab:tvSort', 'duration');
  const [clientSort, setClientSort] = useRouteViewState<SortMode>('StatsTab:clientSort', 'duration');
  const [deviceSort, setDeviceSort] = useRouteViewState<SortMode>('StatsTab:deviceSort', 'duration');
  const [movieSort, setMovieSort] = useRouteViewState<SortMode>('StatsTab:movieSort', 'duration');

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

  // Every stat panel failed: the server is unreachable — without this the page
  // renders only the range/user selectors with all panels silently absent.
  const statQueries = [activityQ, tvQ, movQ, methodQ, clientQ, deviceQ, hourlyQ];
  if (statQueries.every((q) => q.isError && !q.data)) {
    return (
      <ServerErrorState
        onRetry={() => {
          for (const q of statQueries) void q.refetch();
        }}
      />
    );
  }

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
