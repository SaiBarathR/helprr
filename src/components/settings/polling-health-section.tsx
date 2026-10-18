'use client';

import { useQuery } from '@tanstack/react-query';
import { GroupedSection } from '@/components/settings/grouped-section';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { formatDistanceToNowShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { PollingHealth, PollingSourceHealth } from '@/lib/polling-service';

const JOB_LABELS: Record<string, string> = {
  pollSonarr: 'Sonarr',
  pollRadarr: 'Radarr',
  pollLidarr: 'Lidarr',
  pollQBittorrent: 'qBittorrent',
  pollJellyfin: 'Jellyfin',
  pollSeerr: 'Seerr',
  pollServiceReachability: 'Service reachability',
  checkDiskSpace: 'Disk space',
  snapshotDiskUsage: 'Disk usage history',
  checkUpcoming: 'Upcoming premieres',
  refreshScheduledAlertOccurrences: 'Scheduled alert dates',
  checkScheduledAlerts: 'Scheduled alerts',
  checkActivityDigest: 'Activity digest',
  applyBandwidthSchedule: 'Bandwidth schedule',
  checkRetention: 'Retention',
  checkAnimeAutoMap: 'Anime auto-map',
  sweepTasteProfiles: 'Recommendation profiles',
  warmCaches: 'Library cache warming',
};

const FOOTER = 'Checks the services for notifications, alerts, retention and schedules.';

/** A job running this long has outlived any timeout and is stuck. */
const STUCK_MS = 5 * 60 * 1000;

function problem(source: PollingSourceHealth, now: number): string | null {
  if (source.runningSince && now - Date.parse(source.runningSince) > STUCK_MS) {
    return `Still running, started ${formatDistanceToNowShort(source.runningSince)}`;
  }
  if (source.lastFailureAt && (!source.lastSuccessAt || source.lastFailureAt > source.lastSuccessAt)) {
    return `Failed ${formatDistanceToNowShort(source.lastFailureAt)}: ${source.lastError ?? 'unknown error'}`;
  }
  return null;
}

/** Background polling health for administrators (Settings → Service status). */
export function PollingHealthSection() {
  const { data: health, dataUpdatedAt, isError } = useQuery({
    queryKey: queryKeys.adminPolling(),
    queryFn: jsonFetcher<PollingHealth>('/api/admin/polling-status'),
    refetchInterval: 30_000,
  });
  if (!health) {
    if (!isError) return null;
    // The first read failed: say so rather than leave the section out.
    return (
      <GroupedSection title="Background polling" footer={FOOTER}>
        <div className="grouped-row items-start">
          <div className="min-w-0 flex-1 pr-3">
            <div className="text-sm font-medium">Status unavailable</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Couldn&apos;t read the polling status.</div>
          </div>
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
        </div>
      </GroupedSection>
    );
  }

  // Judged at the time of the snapshot, not of this render.
  const problems = health.sources
    .map((source) => ({ source, message: problem(source, dataUpdatedAt) }))
    .filter((entry): entry is { source: PollingSourceHealth; message: string } => entry.message !== null);
  // A failed refresh leaves the last snapshot on screen; it is not shown as healthy.
  const healthy = health.running && problems.length === 0 && !isError;
  const cycle = health.lastCycle;

  return (
    <GroupedSection title="Background polling" footer={FOOTER}>
      <div className="grouped-row items-start">
        <div className="min-w-0 flex-1 pr-3">
          <div className="text-sm font-medium">
            {health.running
              ? `Running every ${Math.round((health.intervalMs ?? 0) / 1000)} s`
              : 'Stopped'}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {isError
              ? `Couldn't refresh this status; last read ${formatDistanceToNowShort(new Date(dataUpdatedAt).toISOString())}.`
              : cycle
                ? `Last cycle finished ${formatDistanceToNowShort(cycle.finishedAt)} in ${(cycle.durationMs / 1000).toFixed(1)} s${cycle.failed ? `, ${cycle.failed} failed` : ''}`
                : 'No cycle has finished yet.'}
          </div>
        </div>
        <span
          className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', healthy ? 'bg-emerald-500' : health.running ? 'bg-amber-500' : 'bg-red-500')}
          aria-hidden
        />
      </div>
      {problems.map(({ source, message }) => (
        <div key={source.source} className="grouped-row items-start">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{JOB_LABELS[source.source] ?? source.source}</div>
            <div className="mt-0.5 break-words text-xs text-muted-foreground">{message}</div>
          </div>
        </div>
      ))}
    </GroupedSection>
  );
}
