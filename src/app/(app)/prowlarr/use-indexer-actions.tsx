'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle, XCircle } from 'lucide-react';
import type { ProwlarrIndexerSummary } from '@/lib/prowlarr-client';

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
 * sheet. Held on the page rather than in a tab, which unmounts when another
 * tab opens: `pendingEnable` holds values sent to Prowlarr and not yet
 * confirmed, laid over the fetched list so a refetch cannot flip a row back.
 */
export function useIndexerActions() {
  const queryClient = useQueryClient();
  const [testingId, setTestingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);
  const [pendingEnable, setPendingEnable] = useState<ReadonlyMap<number, boolean>>(() => new Map());

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
   * Turns an indexer on or off. The row changes straight away and goes back,
   * with a toast, if Prowlarr refuses or cannot be reached.
   */
  async function handleToggle(indexer: ProwlarrIndexerSummary, enable: boolean) {
    setPendingEnable((prev) => new Map(prev).set(indexer.id, enable));
    try {
      const res = await fetch('/api/prowlarr/indexers/bulk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [indexer.id], enable }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : '');
      }
      queryClient.setQueryData<ProwlarrIndexerSummary[]>(['prowlarr', 'indexers'], (prev) =>
        Array.isArray(prev) ? prev.map((i) => (i.id === indexer.id ? { ...i, enable } : i)) : prev,
      );
    } catch (error) {
      toast.error(`Could not ${enable ? 'enable' : 'disable'} ${indexer.name}`, {
        description: error instanceof Error && error.message ? error.message : undefined,
      });
    } finally {
      setPendingEnable((prev) => {
        const next = new Map(prev);
        next.delete(indexer.id);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['prowlarr', 'indexers'] });
      void queryClient.invalidateQueries({ queryKey: ['prowlarr', 'status'] });
      refreshProwlarrHealth(queryClient);
    }
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

  return {
    testingId,
    deletingId,
    confirmDelete,
    setConfirmDelete,
    pendingEnable,
    handleTest,
    handleToggle,
    handleDelete,
  };
}

export type IndexerActions = ReturnType<typeof useIndexerActions>;

/** The fetched list with unconfirmed enable values laid over it. */
export function useIndexersWithPending(
  fetched: ProwlarrIndexerSummary[] | undefined,
  pendingEnable: IndexerActions['pendingEnable'],
) {
  return useMemo(
    () => (fetched ?? []).map((indexer) => (
      pendingEnable.has(indexer.id) ? { ...indexer, enable: pendingEnable.get(indexer.id)! } : indexer
    )),
    [fetched, pendingEnable],
  );
}
