'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useCan } from '@/components/permission-provider';
import { jsonFetcher } from '@/lib/query-fetch';
import {
  BlocklistDrawer,
  BlocklistRow,
  recordKey,
  removeEntries,
  type BlocklistRecord,
} from '@/components/media/blocklist-entry';

/**
 * One movie's or series' blocklist, with Remove, under its history. Same rows,
 * sheet and capabilities as Activity → Blocklist. Shows nothing while empty, so a
 * title that never had a bad release keeps its page as it was.
 */
export function TitleBlocklist({
  source,
  mediaId,
  instanceId,
}: {
  source: 'sonarr' | 'radarr';
  mediaId: number;
  /** The title's instance; entries are read only once it is known. */
  instanceId: string | undefined;
}) {
  const canView = useCan('activity.view');
  const canManage = useCan('activity.manage');
  const queryClient = useQueryClient();
  const [selectedItem, setSelectedItem] = useState<BlocklistRecord | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<BlocklistRecord | null>(null);
  const [removing, setRemoving] = useState(false);

  // Under 'activity' so a Mark as failed (invalidateActivity) brings the new entry in,
  // but not under Activity's own ['activity', 'blocklist'] pages.
  const queryKey = ['activity', 'title-blocklist', source, instanceId ?? '', mediaId] as const;
  const idParam = source === 'radarr' ? 'movieId' : 'seriesId';
  const { data } = useQuery({
    queryKey,
    queryFn: jsonFetcher<{ records?: BlocklistRecord[]; truncated?: boolean }>(
      `/api/activity/blocklist/title?source=${source}&${idParam}=${mediaId}&instanceId=${encodeURIComponent(instanceId ?? '')}`,
    ),
    enabled: canView && !!instanceId && mediaId > 0,
  });
  const entries = Array.isArray(data?.records) ? data.records : [];

  async function confirmRemove() {
    if (!confirmTarget) return;
    setRemoving(true);
    try {
      const { failed } = await removeEntries([confirmTarget]);
      if (failed === 0) toast.success('Removed from blocklist');
      else toast.error('Failed to remove from blocklist');
      setConfirmTarget(null);
      setSelectedItem(null);
    } finally {
      setRemoving(false);
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ['activity', 'blocklist'] });
    }
  }

  if (!canView || entries.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-bold leading-tight">Blocklist</h2>
      <div className="space-y-1">
        {entries.map((item) => (
          <BlocklistRow
            key={recordKey(item)}
            item={item}
            selectable={false}
            selected={false}
            onSelect={() => setSelectedItem(item)}
            onRemove={canManage ? () => setConfirmTarget(item) : undefined}
          />
        ))}
      </div>
      {data?.truncated && (
        <p className="text-xs text-amber-400">Only the newest entries are listed here.</p>
      )}

      <BlocklistDrawer
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onRemove={canManage ? (item) => { setSelectedItem(null); setConfirmTarget(item); } : undefined}
      />

      <ConfirmDialog
        open={!!confirmTarget}
        onOpenChange={(open) => { if (!open && !removing) setConfirmTarget(null); }}
        title="Remove from the blocklist?"
        description={`${confirmTarget?.sourceTitle ?? 'This release'} can be grabbed again by an automatic or manual search.`}
        confirmLabel="Remove"
        destructive
        busy={removing}
        onConfirm={confirmRemove}
      />
    </section>
  );
}
