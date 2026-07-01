// Post-mutation refresh, one rule applied everywhere: an action on an entity
// refetches that entity's own detail + the list it lives in — nothing else.
//
// Granularity matters for load: the list is the [svc, 'library'] PREFIX (catches
// slim + full + every instance), never the bare [svc] prefix — that would also
// refetch reference data (quality profiles / tags / root folders) that hooks
// deliberately hold at a long staleTime. Call these AFTER any optimistic
// setQueryData/removeQueries the handler already does; invalidateQueries only
// refetches mounted queries, so off-screen views just go stale and repaint from
// cache on next visit.

import type { QueryClient } from '@tanstack/react-query';
import { queryKeys, type ArrService } from '@/lib/query-keys';

function invalidateArr(
  qc: QueryClient,
  svc: ArrService,
  t: { itemId?: number; instanceId?: string } = {},
) {
  qc.invalidateQueries({ queryKey: [svc, 'library'] }); // the list (slim + full, all instances)
  qc.invalidateQueries({ queryKey: [svc, 'rename'] }); // rename previews derive from the files
  qc.invalidateQueries({ queryKey: [svc, 'history'] }); // per-item history on the files pages
  if (t.itemId != null) {
    // the detail
    qc.invalidateQueries({ queryKey: queryKeys.detail(svc, t.itemId, t.instanceId) });
    qc.invalidateQueries({ queryKey: queryKeys.credits(svc, t.itemId, t.instanceId) });
    if (svc === 'sonarr') {
      qc.invalidateQueries({ queryKey: ['sonarr', 'episodes'] }); // slim + withfile variants
      qc.invalidateQueries({ queryKey: queryKeys.anime(t.itemId, t.instanceId) });
    }
    if (svc === 'lidarr') {
      qc.invalidateQueries({ queryKey: ['lidarr', 'albums'] }); // per-artist album lists
    }
  }
}

export const invalidateSeries = (qc: QueryClient, t: { itemId?: number; instanceId?: string } = {}) =>
  invalidateArr(qc, 'sonarr', t);
export const invalidateMovies = (qc: QueryClient, t: { itemId?: number; instanceId?: string } = {}) =>
  invalidateArr(qc, 'radarr', t);
export const invalidateMusic = (qc: QueryClient, t: { itemId?: number; instanceId?: string } = {}) =>
  invalidateArr(qc, 'lidarr', t);

// Collections derive from the movie library, so a collection action (monitor toggle,
// add-missing) can change both. Refetch the collections list and the movie library.
export function invalidateCollections(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['radarr', 'collections'] });
  qc.invalidateQueries({ queryKey: ['radarr', 'library'] });
}

// Activity: queue / history / wanted / manual-import all share the ['activity'] prefix.
export const invalidateActivity = (qc: QueryClient) =>
  qc.invalidateQueries({ queryKey: ['activity'] });

// Service connections appear in two lists: the settings list (queryKeys.instances())
// and the activity per-instance filter (['arr-instances'], a deliberately separate key).
export function invalidateInstances(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: queryKeys.instances() });
  qc.invalidateQueries({ queryKey: ['arr-instances'] });
}
