'use client';

import { useState } from 'react';
import { Ban } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { invalidateActivity } from '@/lib/query-invalidation';
import type { HistoryItem } from '@/types';

// Shared by Activity → History and a title's own history (movie Files, series History).

/** A history event with the app and instance it came from: the event id is per instance. */
export type MarkFailedEvent = HistoryItem & { source?: string };

// Mark as failed applies to the download behind a grab or an import. An import
// without a download id was a manual import of files: there is no download to fail.
const IMPORT_EVENTS = new Set(['downloadFolderImported', 'downloadImported', 'trackFileImported']);

export function canMarkFailed(item: MarkFailedEvent): boolean {
  if (!item.instanceId || !item.source) return false;
  return item.eventType === 'grabbed' || (IMPORT_EVENTS.has(item.eventType) && !!item.downloadId);
}

/** Fails a grabbed or imported download after a confirm: the *arr blocklists the release and searches again. */
export function MarkFailedButton({ item, onDone }: { item: MarkFailedEvent; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const appName = item.source === 'radarr' ? 'Radarr' : item.source === 'lidarr' ? 'Lidarr' : 'Sonarr';

  async function markFailed() {
    setBusy(true);
    try {
      const res = await fetch(`/api/activity/history/${item.id}/failed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: item.source, instanceId: item.instanceId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to mark as failed');
      }
      toast.success('Marked as failed');
      setConfirming(false);
      onDone();
      void invalidateActivity(queryClient);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to mark as failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        className="w-full border-destructive text-destructive hover:bg-destructive/10"
        onClick={() => setConfirming(true)}
      >
        <Ban />
        Mark as failed
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => { if (!busy) setConfirming(open); }}
        title="Mark as failed?"
        description={`${appName} will blocklist this release and search for another one.${
          item.eventType === 'grabbed' ? '' : ' Files already imported stay in the library.'
        }`}
        confirmLabel="Mark as failed"
        destructive
        busy={busy}
        onConfirm={markFailed}
      />
    </>
  );
}
