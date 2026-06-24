import type { WatchLookupQuery } from '@/components/jellyfin/watch-status-provider';
import type { MediaWatchFilterPreference } from '@/lib/store';
import { isFullyWatched, type WatchStatus } from '@/types/watch-status';

/** Client-side watch filter — mirrors /api/random-watch isEligibleUnwatched semantics. */
export function matchesWatchFilter(
  filter: MediaWatchFilterPreference,
  lookup: (query: WatchLookupQuery) => WatchStatus | undefined,
  scope: 'radarr' | 'sonarr',
  instanceId: string | undefined,
  arrId: number,
): boolean {
  if (filter === 'all') return true;
  if (!instanceId) return filter === 'unwatched';

  const status = lookup({ scope, instanceId, arrId });
  if (filter === 'watched') return status != null && isFullyWatched(status);
  return !status || !isFullyWatched(status);
}
