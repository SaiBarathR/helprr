'use client';

import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import type { QueryClient } from '@tanstack/react-query';
import { pollCommand } from '@/lib/arr-command';
import { invalidateActivity } from '@/lib/query-invalidation';

// A manual import is an asynchronous *arr command, and the *arr only drops the
// download from its queue on its next monitored-downloads refresh, so the
// Activity tabs kept showing a finished import until a poll or a tab switch
// caught up. This tracks the imports submitted from the import page: the queue
// shows them as importing until it's read again after that refresh, and from
// then on shows what the *arr says. A fully imported download is gone; a partly
// imported one (Sonarr finishes the command either way) is back with its reason.

type ImportService = 'sonarr' | 'radarr';

interface QueueRecordIdentity {
  source?: string;
  instanceId?: string;
  downloadId?: string;
}

/** Download key → the import that marked it, so an earlier import of the same
 * download finishing doesn't clear a later one's mark. */
export type PendingImports = ReadonlyMap<string, number>;

/**
 * How long after the refresh to read the queue again: the server keeps its copy
 * for 5s (QUEUE_CACHE_TTL_SECONDS in lib/activity-queue.ts), plus a margin for
 * a read that was already in flight.
 */
const QUEUE_SETTLE_MS = 6_000;

const EMPTY: PendingImports = new Map();
let pending: PendingImports = EMPTY;
let lastImportId = 0;
const listeners = new Set<() => void>();

function setPending(next: PendingImports) {
  pending = next;
  listeners.forEach((listener) => listener());
}

function markImporting(key: string): number {
  const importId = ++lastImportId;
  setPending(new Map(pending).set(key, importId));
  return importId;
}

function clearImporting(key: string, importId: number) {
  if (pending.get(key) !== importId) return;
  const next = new Map(pending);
  next.delete(key);
  setPending(next);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function pendingImportKey(record: QueueRecordIdentity): string {
  return `${record.source ?? ''}|${record.instanceId ?? ''}|${record.downloadId ?? ''}`;
}

export function usePendingImports(): PendingImports {
  return useSyncExternalStore(subscribe, () => pending, () => EMPTY);
}

/**
 * Queue records as the user should see them: a download being imported reads
 * as importing, so it no longer counts as needing attention and drops out of
 * the Failed tab until the import is over.
 */
export function applyPendingImports<T extends QueueRecordIdentity & {
  trackedDownloadState?: string;
  trackedDownloadStatus?: string;
}>(records: T[], imports: PendingImports): T[] {
  if (imports.size === 0) return records;
  return records.map((record) => (imports.has(pendingImportKey(record))
    ? { ...record, trackedDownloadState: 'importing', trackedDownloadStatus: 'ok' }
    : record));
}

async function refreshMonitoredDownloads(service: ImportService, instanceId?: string) {
  try {
    const url = instanceId
      ? `/api/${service}/command?instanceId=${encodeURIComponent(instanceId)}`
      : `/api/${service}/command`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'RefreshMonitoredDownloads' }),
    });
    if (!res.ok) return;
    const command = (await res.json().catch(() => null)) as { id?: number } | null;
    if (command?.id) await pollCommand(service, command.id, instanceId);
  } catch {
    // Best effort: the queue's own poll still catches up later.
  }
}

/**
 * Follow a submitted manual import to the end. Never rejects; reports the
 * outcome with a toast that replaces the "Importing…" one.
 */
export async function trackManualImport(
  queryClient: QueryClient,
  { service, instanceId, downloadId, commandId, title }: {
    service: ImportService;
    instanceId?: string;
    downloadId: string;
    commandId?: number;
    title: string;
  },
) {
  const key = pendingImportKey({ source: service, instanceId, downloadId });
  const importId = markImporting(key);
  const toastId = `manual-import:${importId}`;
  toast.loading(`Importing ${title}…`, { id: toastId });

  const status = commandId ? await pollCommand(service, commandId, instanceId) : 'completed';
  if (status !== 'completed') {
    clearImporting(key, importId);
    toast.error(
      status === 'timeout'
        ? `${title} is still importing. Check the queue in a minute.`
        : `Import failed for ${title}`,
      { id: toastId },
    );
    void invalidateActivity(queryClient);
    return;
  }

  // Have the *arr drop the finished download from its queue now rather than on
  // its next scheduled refresh, then read the queue again (the refetch cancels
  // one already in flight) once the server's copy is newer than that refresh.
  await refreshMonitoredDownloads(service, instanceId);
  await new Promise((resolve) => setTimeout(resolve, QUEUE_SETTLE_MS));
  await invalidateActivity(queryClient);
  clearImporting(key, importId);
  // Only the command's outcome is known here: whether every file went in shows
  // in the queue, which lists the download again if some didn't.
  toast.success(`Import finished for ${title}`, { id: toastId });
  void queryClient.invalidateQueries({ queryKey: ['badges'] });
}

/** Test hook: forget every tracked import. */
export function resetPendingImportsForTests() {
  setPending(EMPTY);
}
