'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle, XCircle } from 'lucide-react';
import type { ProwlarrBulkEdit, ProwlarrIndexerSummary } from '@/lib/prowlarr-client';

export type IndexerEdit = Partial<Pick<ProwlarrIndexerSummary, 'enable' | 'priority' | 'appProfileId' | 'tags'>>;

/**
 * Re-reads Prowlarr's health now and again a few seconds later: Prowlarr
 * reruns its checks about 5 s after an indexer change or test, so the first
 * read can still hold the previous result.
 */
export function refreshProwlarrHealth(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['prowlarr', 'health'] });
  setTimeout(() => {
    void queryClient.invalidateQueries({ queryKey: ['prowlarr', 'health'] });
  }, 7_000);
}

/**
 * Test, enable/disable and delete for one indexer, shared by the rows and the
 * sheet, and the same edits and delete for a selection. Held on the page rather than in a tab, which unmounts when another
 * tab opens: `pendingEdits` holds values sent to Prowlarr and not yet
 * confirmed, laid over the fetched list so a refetch cannot flip a row back.
 */
export function useIndexerActions() {
  const queryClient = useQueryClient();
  const [testingId, setTestingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);
  const [pendingEdits, setPendingEdits] = useState<ReadonlyMap<number, IndexerEdit>>(() => new Map());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  /**
   * Initiates a test for the indexer with the given id, displays a success or error toast, and manages the testing state while the request is in progress.
   *
   * @param id - The indexer's numeric id to test
   */
  async function handleTest(id: number) {
    setTestingId(id);
    try {
      const res = await fetch(`/api/prowlarr/indexers/${id}/test`, { method: 'POST' });
      if (res.ok) {
        toast.success('Indexer test passed', { icon: <CheckCircle className="h-4 w-4 text-green-500" /> });
      } else {
        const data = await res.json();
        toast.error(data.error || 'Test failed', { icon: <XCircle className="h-4 w-4 text-red-500" /> });
      }
    } catch {
      toast.error('Test failed');
    } finally {
      setTestingId(null);
    }
  }

  /**
   * Sends one edit for one or more indexers. The rows change straight away and
   * go back if Prowlarr refuses or cannot be reached; Prowlarr applies a batch
   * whole or not at all, so the result holds for every indexer in it.
   *
   * @param targets - The indexers being edited
   * @param changeFor - What each indexer looks like after the edit
   * @param body - What to send (tags add or remove the ones named)
   * @returns Null when saved, or Prowlarr's or Helprr's reason ('' when none)
   */
  async function sendEdit(
    targets: ProwlarrIndexerSummary[],
    changeFor: (indexer: ProwlarrIndexerSummary) => IndexerEdit,
    body: Omit<ProwlarrBulkEdit, 'ids'>,
  ): Promise<string | null> {
    const changes = new Map(targets.map((indexer) => [indexer.id, changeFor(indexer)]));
    // Laid over any edit still on its way for the same indexer, not in place of it.
    setPendingEdits((prev) => {
      const next = new Map(prev);
      for (const [id, change] of changes) next.set(id, { ...prev.get(id), ...change });
      return next;
    });
    try {
      const res = await fetch('/api/prowlarr/indexers/bulk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...changes.keys()], ...body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return typeof data.error === 'string' ? data.error : '';
      }
      queryClient.setQueryData<ProwlarrIndexerSummary[]>(['prowlarr', 'indexers'], (prev) =>
        Array.isArray(prev) ? prev.map((i) => (changes.has(i.id) ? { ...i, ...changes.get(i.id) } : i)) : prev,
      );
      return null;
    } catch {
      return '';
    } finally {
      setPendingEdits((prev) => {
        const next = new Map(prev);
        for (const id of changes.keys()) next.delete(id);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['prowlarr', 'indexers'] });
      void queryClient.invalidateQueries({ queryKey: ['prowlarr', 'status'] });
      refreshProwlarrHealth(queryClient);
    }
  }

  /**
   * Saves one edit. The row changes straight away and goes back, with a toast,
   * if Prowlarr refuses or cannot be reached.
   *
   * @param indexer - The indexer being edited
   * @param change - What the indexer looks like after the edit
   * @param body - What to send, when it differs from `change` (tags add or remove one)
   * @param failure - The toast title on failure
   */
  async function handleEdit(
    indexer: ProwlarrIndexerSummary,
    change: IndexerEdit,
    failure: string,
    body: Omit<ProwlarrBulkEdit, 'ids'> = change,
  ) {
    const error = await sendEdit([indexer], () => change, body);
    if (error !== null) toast.error(failure, { description: error || undefined });
  }

  /**
   * The same edit for every selected indexer, in one request, with a toast
   * either way. Resolves true when saved.
   */
  async function handleBulkEdit(
    targets: ProwlarrIndexerSummary[],
    changeFor: (indexer: ProwlarrIndexerSummary) => IndexerEdit,
    body: Omit<ProwlarrBulkEdit, 'ids'>,
    messages: { success: string; failure: string },
  ): Promise<boolean> {
    const error = await sendEdit(targets, changeFor, body);
    if (error === null) toast.success(messages.success);
    else toast.error(messages.failure, { description: error || undefined });
    return error === null;
  }

  function handleToggle(indexer: ProwlarrIndexerSummary, enable: boolean) {
    return handleEdit(indexer, { enable }, `Could not ${enable ? 'enable' : 'disable'} ${indexer.name}`);
  }

  /**
   * Deletes the indexer identified by `id` via the server API, removes it from the local indexer list on success, shows a success or error toast based on the response, and clears deletion-related UI state.
   *
   * @param id - The numeric ID of the indexer to delete
   * @returns Whether the indexer was deleted
   */
  async function handleDelete(id: number): Promise<boolean> {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/prowlarr/indexers/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Indexer deleted');
        // Drop it from the shared cache immediately (instant, as before), then
        // refresh status so any stale block for the gone indexer clears.
        queryClient.setQueryData<ProwlarrIndexerSummary[]>(['prowlarr', 'indexers'], (prev) =>
          Array.isArray(prev) ? prev.filter((i) => i.id !== id) : prev,
        );
        void queryClient.invalidateQueries({ queryKey: ['prowlarr', 'status'] });
        return true;
      }
      const data = await res.json();
      toast.error(data.error || 'Failed to delete');
    } catch {
      toast.error('Failed to delete');
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
    return false;
  }

  /**
   * Deletes the selected indexers in one request and says which went: the
   * route reads Prowlarr's list again afterwards. Resolves true when all did.
   */
  async function handleBulkDelete(targets: ProwlarrIndexerSummary[]): Promise<boolean> {
    const names = new Map(targets.map((indexer) => [indexer.id, indexer.name]));
    setBulkDeleting(true);
    try {
      const res = await fetch('/api/prowlarr/indexers/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...names.keys()] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.deleted) || !Array.isArray(data.failed)) {
        toast.error('Failed to delete indexers', { description: typeof data.error === 'string' ? data.error : undefined });
        return false;
      }
      const deleted = new Set<number>(data.deleted);
      queryClient.setQueryData<ProwlarrIndexerSummary[]>(['prowlarr', 'indexers'], (prev) =>
        Array.isArray(prev) ? prev.filter((i) => !deleted.has(i.id)) : prev,
      );
      const failed = (data.failed as number[]).map((id) => names.get(id) ?? `Indexer ${id}`);
      if (failed.length === 0) {
        toast.success(deleted.size === 1 ? 'Indexer deleted' : `${deleted.size} indexers deleted`);
        return true;
      }
      toast.error(
        deleted.size > 0 ? `${deleted.size} deleted, ${failed.length} not deleted` : 'Failed to delete indexers',
        { description: failed.join(', ') },
      );
      return false;
    } catch {
      toast.error('Failed to delete indexers');
      return false;
    } finally {
      setBulkDeleting(false);
      void queryClient.invalidateQueries({ queryKey: ['prowlarr', 'indexers'] });
      void queryClient.invalidateQueries({ queryKey: ['prowlarr', 'status'] });
      refreshProwlarrHealth(queryClient);
    }
  }

  return {
    testingId,
    deletingId,
    confirmDelete,
    setConfirmDelete,
    pendingEdits,
    handleTest,
    handleEdit,
    handleBulkEdit,
    handleToggle,
    handleDelete,
    bulkDeleting,
    handleBulkDelete,
  };
}

export type IndexerActions = ReturnType<typeof useIndexerActions>;

/** The fetched list with unconfirmed edits laid over it. */
export function useIndexersWithPending(
  fetched: ProwlarrIndexerSummary[] | undefined,
  pendingEdits: IndexerActions['pendingEdits'],
) {
  return useMemo(
    () => (fetched ?? []).map((indexer) => ({ ...indexer, ...pendingEdits.get(indexer.id) })),
    [fetched, pendingEdits],
  );
}
