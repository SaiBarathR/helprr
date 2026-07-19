'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { GroupedSection } from '@/components/settings/grouped-section';
import { DiskLowSpaceAlerts } from '@/components/settings/disk-low-space-alerts';
import { useAppSettings } from '@/lib/hooks/use-app-settings';
import { jsonFetcher } from '@/lib/query-fetch';

interface CacheUsageStats {
  imageBytes: number;
  tmdbApiBytes: number;
  anilistApiBytes: number;
  apiBytes: number;
  totalBytes: number;
  imageFiles: number;
  tmdbEntries: number;
  anilistEntries: number;
  apiEntries: number;
}
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
}

function parseUsage(raw: unknown): CacheUsageStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Partial<CacheUsageStats>;
  // A payload without a numeric total is malformed — treat as unavailable
  // rather than rendering it as a healthy 0 B.
  if (typeof u.totalBytes !== 'number') return null;
  return {
    imageBytes: typeof u.imageBytes === 'number' ? u.imageBytes : 0,
    tmdbApiBytes: typeof u.tmdbApiBytes === 'number' ? u.tmdbApiBytes : 0,
    anilistApiBytes: typeof u.anilistApiBytes === 'number' ? u.anilistApiBytes : 0,
    apiBytes: typeof u.apiBytes === 'number' ? u.apiBytes : 0,
    totalBytes: typeof u.totalBytes === 'number' ? u.totalBytes : 0,
    imageFiles: typeof u.imageFiles === 'number' ? u.imageFiles : 0,
    tmdbEntries: typeof u.tmdbEntries === 'number' ? u.tmdbEntries : 0,
    anilistEntries: typeof u.anilistEntries === 'number' ? u.anilistEntries : 0,
    apiEntries: typeof u.apiEntries === 'number' ? u.apiEntries : 0,
  };
}

const CACHE_USAGE_KEY = ['settings', 'cache-usage'] as const;
const CLEANUP_SUMMARY_KEY = ['cleanup', 'history-summary'] as const;

interface CacheApiResponse {
  usage?: unknown;
  status?: unknown;
  lastPurgedAt?: unknown;
}

export default function StorageSettingsPage() {
  const { settings, loading, update } = useAppSettings();
  const queryClient = useQueryClient();
  const cacheImagesEnabled = settings?.cacheImagesEnabled ?? true;

  const [purgingCache, setPurgingCache] = useState(false);
  const [olderThanDays, setOlderThanDays] = useState('30');
  const [confirmOlder, setConfirmOlder] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [deletingHistory, setDeletingHistory] = useState(false);

  // Explicit loading/error/data states: a failed load must never render as a
  // healthy "0 B" or leave the page stuck on "Loading…" with no recovery.
  const cacheQuery = useQuery({
    queryKey: CACHE_USAGE_KEY,
    queryFn: jsonFetcher<CacheApiResponse>('/api/settings/cache'),
    enabled: cacheImagesEnabled,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const cacheUsage = cacheQuery.data ? parseUsage(cacheQuery.data.usage) : null;
  const cacheStatus: 'idle' | 'purging' =
    cacheQuery.data?.status === 'purging' ? 'purging' : 'idle';
  const cacheLastPurgedAt =
    typeof cacheQuery.data?.lastPurgedAt === 'string' ? cacheQuery.data.lastPurgedAt : null;

  // Zero is only rendered when a successful response actually says zero;
  // absent/malformed data reads "Unavailable" instead of "0 B".
  const usageValue = (fmt: (u: CacheUsageStats) => string): string =>
    cacheQuery.isLoading ? 'Loading…' : cacheUsage ? fmt(cacheUsage) : 'Unavailable';

  const summaryQuery = useQuery({
    queryKey: CLEANUP_SUMMARY_KEY,
    queryFn: jsonFetcher<{ total?: unknown; oldestAt?: unknown }>('/api/cleanup/history?summary=true'),
  });
  const cleanupSummary = summaryQuery.data
    ? {
        total: typeof summaryQuery.data.total === 'number' ? summaryQuery.data.total : 0,
        oldestAt: typeof summaryQuery.data.oldestAt === 'string' ? summaryQuery.data.oldestAt : null,
      }
    : null;

  async function handleToggleCache(next: boolean) {
    const updated = await update(
      { cacheImagesEnabled: next },
      {
        successMessage: (_, raw) => {
          if (next) return undefined;
          const bytes = (raw as { cachePurge?: { deletedTotalBytes?: unknown } } | null)
            ?.cachePurge?.deletedTotalBytes;
          if (typeof bytes === 'number' && bytes > 0) {
            return `Cache deleted (${formatBytes(bytes)})`;
          }
          return undefined;
        },
      },
    );
    if (!updated) return;
    // Server purges when disabled; drop the cached snapshot either way so a
    // re-enable starts from a fresh fetch instead of stale numbers.
    queryClient.removeQueries({ queryKey: CACHE_USAGE_KEY });
  }

  async function handleDeleteCache() {
    setPurgingCache(true);
    try {
      const res = await fetch('/api/settings/cache', { method: 'DELETE' });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(payload?.error || 'Failed to delete cache');
        return;
      }
      if (payload?.result?.deletedTotalBytes) {
        toast.success(`Cache deleted (${formatBytes(payload.result.deletedTotalBytes)})`);
      } else {
        toast.success('Cache deleted');
      }
      void queryClient.invalidateQueries({ queryKey: CACHE_USAGE_KEY });
    } catch {
      toast.error('Failed to delete cache');
    } finally {
      setPurgingCache(false);
    }
  }

  async function deleteCleanupHistory(query: string) {
    setDeletingHistory(true);
    try {
      const res = await fetch(`/api/cleanup/history?${query}`, { method: 'DELETE' });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(payload?.error || 'Failed to delete cleanup history');
        return;
      }
      const deleted = typeof payload?.deleted === 'number' ? payload.deleted : 0;
      toast.success(deleted === 0 ? 'No matching rows to delete' : `Deleted ${deleted} row${deleted === 1 ? '' : 's'}`);
      await queryClient.invalidateQueries({ queryKey: CLEANUP_SUMMARY_KEY });
    } catch {
      toast.error('Failed to delete cleanup history');
    } finally {
      setDeletingHistory(false);
    }
  }

  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1"
        >
          <ChevronLeft className="h-5 w-5" />
          Settings
        </Link>
      </div>

      <div className="px-4 mb-4">
        <h1 className="text-2xl font-semibold">Storage</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Server-side cache and cleanup history.
        </p>
      </div>

      <GroupedSection title="Server cache" footer="Master switch for images and API response caching · Server action affects all clients">
        <div className="grouped-row">
          <span className="text-sm">Cache images &amp; API responses</span>
          <Switch
            checked={cacheImagesEnabled}
            onCheckedChange={handleToggleCache}
            disabled={loading}
            aria-label="Cache images and API responses"
          />
        </div>

        {cacheImagesEnabled && cacheQuery.isError && !cacheQuery.data ? (
          <ErrorState
            compact
            message="Couldn't load cache usage."
            onRetry={() => cacheQuery.refetch()}
            retrying={cacheQuery.isFetching}
          />
        ) : cacheImagesEnabled ? (
          <>
            {cacheQuery.isError && (
              <div className="px-4 py-2 text-xs text-destructive">
                Refresh failed — showing last known values.
              </div>
            )}
            <div className="grouped-row">
              <span className="text-sm">Total usage</span>
              <span className="text-sm text-muted-foreground">
                {usageValue((u) => formatBytes(u.totalBytes))}
              </span>
            </div>
            <div className="grouped-row">
              <span className="text-sm">Images</span>
              <span className="text-sm text-muted-foreground">
                {usageValue((u) => `${formatBytes(u.imageBytes)} (${u.imageFiles} files)`)}
              </span>
            </div>
            <div className="grouped-row">
              <span className="text-sm">TMDB API</span>
              <span className="text-sm text-muted-foreground">
                {usageValue((u) => `${formatBytes(u.tmdbApiBytes)} (${u.tmdbEntries} entries)`)}
              </span>
            </div>
            <div className="grouped-row">
              <span className="text-sm">AniList API</span>
              <span className="text-sm text-muted-foreground">
                {usageValue((u) => `${formatBytes(u.anilistApiBytes)} (${u.anilistEntries} entries)`)}
              </span>
            </div>
            <div className="grouped-row">
              <span className="text-sm">API responses</span>
              <span className="text-sm text-muted-foreground">
                {usageValue((u) => `${formatBytes(u.apiBytes)} (${u.apiEntries} entries)`)}
              </span>
            </div>
            <div className="grouped-row">
              <span className="text-sm">Status</span>
              <span className="text-sm text-muted-foreground capitalize">{cacheStatus}</span>
            </div>
            {cacheLastPurgedAt && (
              <div className="grouped-row">
                <span className="text-sm">Last purged</span>
                <span className="text-sm text-muted-foreground">
                  {new Date(cacheLastPurgedAt).toLocaleString()}
                </span>
              </div>
            )}
            <div className="px-4 py-3">
              <Button
                variant="outline"
                className="w-full h-9"
                onClick={handleDeleteCache}
                disabled={purgingCache || cacheStatus === 'purging'}
              >
                {purgingCache ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  'Delete cache now'
                )}
              </Button>
            </div>
          </>
        ) : null}
      </GroupedSection>

      <DiskLowSpaceAlerts />

      <GroupedSection title="Cleanup history" footer="Server action — affects all devices">
        {/* A failed summary load must not sit on "Loading…" forever with the
            cleanup actions silently disabled — surface it with a Retry. */}
        {summaryQuery.isError && !summaryQuery.data && (
          <ErrorState
            compact
            message="Couldn't load cleanup history."
            onRetry={() => summaryQuery.refetch()}
            retrying={summaryQuery.isFetching}
          />
        )}
        <div className="grouped-row">
          <span className="text-sm">Stored rows</span>
          <span className="text-sm text-muted-foreground">
            {summaryQuery.isError && cleanupSummary == null
              ? 'Unavailable'
              : cleanupSummary == null
              ? 'Loading…'
              : cleanupSummary.total === 0
              ? 'No history yet'
              : `${cleanupSummary.total.toLocaleString()} rows`}
          </span>
        </div>
        {cleanupSummary?.oldestAt && (
          <div className="grouped-row">
            <span className="text-sm">Oldest entry</span>
            <span className="text-sm text-muted-foreground">
              {new Date(cleanupSummary.oldestAt).toLocaleString()}
            </span>
          </div>
        )}
        <div className="grouped-row">
          <Label htmlFor="olderThanDays" className="text-sm">Delete rows older than</Label>
          <div className="flex items-center gap-2">
            <Input
              id="olderThanDays"
              type="number"
              inputMode="numeric"
              min={1}
              max={3650}
              value={olderThanDays}
              onChange={(e) => setOlderThanDays(e.target.value)}
              className="w-20 h-8 text-sm text-right"
            />
            <span className="text-sm text-muted-foreground">days</span>
          </div>
        </div>
        <div className="px-4 py-3 flex gap-2">
          <Button
            variant="outline"
            className="flex-1 h-9"
            onClick={() => setConfirmOlder(true)}
            disabled={
              deletingHistory
              || !cleanupSummary
              || cleanupSummary.total === 0
              || !Number.isFinite(Number(olderThanDays))
              || !Number.isInteger(Number(olderThanDays))
              || Number(olderThanDays) < 1
              || Number(olderThanDays) > 3650
            }
          >
            {deletingHistory ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Deleting…
              </>
            ) : (
              'Clear older'
            )}
          </Button>
          <Button
            variant="outline"
            className="flex-1 h-9 text-destructive hover:text-destructive"
            onClick={() => setConfirmAll(true)}
            disabled={deletingHistory || !cleanupSummary || cleanupSummary.total === 0}
          >
            Clear all
          </Button>
        </div>
      </GroupedSection>

      <ConfirmDialog
        open={confirmOlder}
        onOpenChange={setConfirmOlder}
        title={`Delete cleanup history older than ${olderThanDays} day${olderThanDays === '1' ? '' : 's'}?`}
        description={`Rows created before ${new Date(Date.now() - Math.max(1, Number(olderThanDays) || 0) * 86_400_000).toLocaleString()} will be permanently deleted. This cannot be undone.`}
        confirmLabel="Yes, delete"
        cancelLabel="Cancel"
        destructive
        busy={deletingHistory}
        onConfirm={() => deleteCleanupHistory(`olderThanDays=${encodeURIComponent(olderThanDays)}`)}
      />
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Delete all cleanup history?"
        description="Every cleanup audit row will be removed. The cleaners will still run normally — only the historical log is wiped. This cannot be undone."
        confirmLabel="Yes, delete all"
        cancelLabel="Cancel"
        destructive
        busy={deletingHistory}
        onConfirm={() => deleteCleanupHistory('all=true')}
      />
    </div>
  );
}
