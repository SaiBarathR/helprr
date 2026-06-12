'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';
import { Eyebrow, HPR } from '@/components/widgets/bento-primitives';
import { RankedList, HourlyHeatmap, PlayActivityChart } from '@/components/widgets/jellyfin-stats-charts';
import { PanelLoading } from './insights-shared';
import type { InsightsRange } from './insights-shared';
import type { PlaybackBreakdownEntry, PlayActivityUser, PlaybackUserActivity } from '@/types/jellyfin';

function SubCard({ label, height, children }: { label: string; height: number; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Eyebrow>{label}</Eyebrow>
      <div style={{ height }}>{children}</div>
    </div>
  );
}

export function WatchStatsSection({ range }: { range: InsightsRange }) {
  const [loading, setLoading] = React.useState(true);
  const [pluginAvailable, setPluginAvailable] = React.useState(true);
  const [shows, setShows] = React.useState<PlaybackBreakdownEntry[]>([]);
  const [movies, setMovies] = React.useState<PlaybackBreakdownEntry[]>([]);
  const [activity, setActivity] = React.useState<PlayActivityUser[]>([]);
  const [hourly, setHourly] = React.useState<Record<string, number>>({});
  const [users, setUsers] = React.useState<PlaybackUserActivity[]>([]);

  React.useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const q = `days=${range.days}`;
    setLoading(true);

    (async () => {
      const [tvRes, movRes, actRes, hourRes, userRes] = await Promise.allSettled([
        fetch(`/api/jellyfin/playback/tv-shows?${q}`, { signal }),
        fetch(`/api/jellyfin/playback/movies?${q}`, { signal }),
        fetch(`/api/jellyfin/playback/activity?${q}`, { signal }),
        fetch(`/api/jellyfin/playback/hourly?${q}`, { signal }),
        fetch(`/api/jellyfin/playback/users?${q}`, { signal }),
      ]);
      if (signal.aborted) return;

      let plugin = true;
      let nShows: PlaybackBreakdownEntry[] = [];
      let nMovies: PlaybackBreakdownEntry[] = [];
      let nActivity: PlayActivityUser[] = [];
      let nHourly: Record<string, number> = {};
      let nUsers: PlaybackUserActivity[] = [];

      if (tvRes.status === 'fulfilled' && tvRes.value.ok) {
        const d = await tvRes.value.json();
        nShows = d.shows || [];
        if (d.pluginAvailable === false) plugin = false;
      }
      if (movRes.status === 'fulfilled' && movRes.value.ok) {
        const d = await movRes.value.json();
        nMovies = d.movies || [];
        if (d.pluginAvailable === false) plugin = false;
      }
      if (actRes.status === 'fulfilled' && actRes.value.ok) {
        const d = await actRes.value.json();
        nActivity = d.data || [];
        if (d.pluginAvailable === false) plugin = false;
      }
      if (hourRes.status === 'fulfilled' && hourRes.value.ok) {
        const d = await hourRes.value.json();
        nHourly = d.data || {};
        if (d.pluginAvailable === false) plugin = false;
      }
      if (userRes.status === 'fulfilled' && userRes.value.ok) {
        const d = await userRes.value.json();
        nUsers = d.users || [];
        if (d.pluginAvailable === false) plugin = false;
      }
      if (signal.aborted) return;

      setShows(nShows);
      setMovies(nMovies);
      setActivity(nActivity);
      setHourly(nHourly);
      setUsers(nUsers);
      setPluginAvailable(plugin);
      setLoading(false);
    })().catch((err) => {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setLoading(false);
    });

    return () => controller.abort();
  }, [range.days]);

  const userEntries: PlaybackBreakdownEntry[] = React.useMemo(
    () =>
      users
        .filter((u) => u.user_id !== 'labels_user')
        .map((u) => ({ label: u.user_name, count: u.total_count, time: u.total_time })),
    [users]
  );

  const heading = (
    <h2 style={{ fontFamily: 'var(--hpr-font-display)', fontWeight: 600, fontSize: 15, color: HPR.fg, margin: 0 }}>
      Watch activity
    </h2>
  );

  if (loading && shows.length === 0 && movies.length === 0 && activity.length === 0) {
    return (
      <div className="space-y-3">
        {heading}
        <div className="rounded-xl bg-card border p-4">
          <PanelLoading height={160} />
        </div>
      </div>
    );
  }

  if (!pluginAvailable) {
    return (
      <div className="space-y-3">
        {heading}
        <div className="rounded-xl bg-card border p-6 text-center">
          <AlertCircle className="h-7 w-7 mx-auto mb-2" style={{ color: HPR.fgSubtle }} />
          <p className="text-sm font-medium" style={{ color: HPR.fgMute }}>
            Playback Reporting Plugin not detected
          </p>
          <p className="text-xs mt-1" style={{ color: HPR.fgSubtle }}>
            Install the Jellyfin Playback Reporting Plugin to see watch history and statistics.
          </p>
        </div>
      </div>
    );
  }

  const hasData =
    shows.length > 0 ||
    movies.length > 0 ||
    activity.length > 0 ||
    userEntries.length > 0 ||
    Object.keys(hourly).length > 0;
  if (!hasData) {
    return (
      <div className="space-y-3">
        {heading}
        <div className="rounded-xl bg-card border p-6 text-center text-xs" style={{ color: HPR.fgSubtle }}>
          No playback recorded in this range.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {heading}
      <div className="space-y-4">
        {activity.length > 0 && (
          <SubCard label="Plays over time" height={200}>
            <PlayActivityChart data={activity} />
          </SubCard>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {shows.length > 0 && (
            <SubCard label="Most-watched series" height={280}>
              <RankedList entries={shows} sortBy="plays" maxVisible={6} />
            </SubCard>
          )}
          {movies.length > 0 && (
            <SubCard label="Most-watched movies" height={280}>
              <RankedList entries={movies} sortBy="plays" maxVisible={6} />
            </SubCard>
          )}
        </div>
        {Object.keys(hourly).length > 0 && (
          <SubCard label="When people watch" height={240}>
            <HourlyHeatmap data={hourly} />
          </SubCard>
        )}
        {userEntries.length > 0 && (
          <SubCard label="Top viewers" height={Math.min(6, userEntries.length) * 46 + 12}>
            <RankedList entries={userEntries} sortBy="plays" maxVisible={6} />
          </SubCard>
        )}
      </div>
    </div>
  );
}
