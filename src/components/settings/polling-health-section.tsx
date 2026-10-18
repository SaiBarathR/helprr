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
};

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
  const { data: health, dataUpdatedAt } = useQuery({
    queryKey: queryKeys.adminPolling(),
    queryFn: jsonFetcher<PollingHealth>('/api/admin/polling-status'),
    refetchInterval: 30_000,
  });
  if (!health) return null;

  // Judged at the time of the snapshot, not of this render.
  const problems = health.sources
    .map((source) => ({ source, message: problem(source, dataUpdatedAt) }))
    .filter((entry): entry is { source: PollingSourceHealth; message: string } => entry.message !== null);
  const healthy = health.running && problems.length === 0;
  const cycle = health.lastCycle;

  return (
    <GroupedSection
      title="Background polling"
      footer="Checks the services for notifications, alerts, retention and schedules."
    >
      <div className="grouped-row items-start">
        <div className="min-w-0 flex-1 pr-3">
          <div className="text-sm font-medium">
            {health.running
              ? `Running every ${Math.round((health.intervalMs ?? 0) / 1000)} s`
              : 'Stopped'}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {cycle
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
