// A monitor toggle patches the cached library lists in place. Ids are only unique
// per instance, so the patch must not flip a same-id item on another instance.
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { patchLibraryMonitored } from '@/lib/query-invalidation';
import { queryKeys } from '@/lib/query-keys';

const list = () => [
  { id: 5, instanceId: 'rad-1', title: 'Dune', monitored: true },
  { id: 5, instanceId: 'rad-2', title: 'Alien', monitored: true },
  { id: 6, instanceId: 'rad-1', title: 'Heat', monitored: true },
];

describe('patchLibraryMonitored', () => {
  it('flips only the item on the same instance, in every cached list', () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.library('radarr'), list());
    qc.setQueryData(queryKeys.library('radarr', { full: true }), list());

    patchLibraryMonitored(qc, 'radarr', { itemId: 5, instanceId: 'rad-2', monitored: false });

    for (const key of [queryKeys.library('radarr'), queryKeys.library('radarr', { full: true })]) {
      expect(qc.getQueryData<ReturnType<typeof list>>(key)!.map((m) => [m.instanceId, m.id, m.monitored])).toEqual([
        ['rad-1', 5, true],
        ['rad-2', 5, false],
        ['rad-1', 6, true],
      ]);
    }
  });

  it('refetches instead of guessing when the instance is unknown', () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.library('sonarr'), list());

    patchLibraryMonitored(qc, 'sonarr', { itemId: 5, monitored: false });

    expect(qc.getQueryData<ReturnType<typeof list>>(queryKeys.library('sonarr'))!.every((s) => s.monitored)).toBe(true);
    expect(qc.getQueryState(queryKeys.library('sonarr'))!.isInvalidated).toBe(true);
  });
});
