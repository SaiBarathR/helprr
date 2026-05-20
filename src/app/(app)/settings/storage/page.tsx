'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { GroupedSection } from '@/components/settings/grouped-section';
import { useAppSettings } from '@/lib/hooks/use-app-settings';

interface CacheUsageStats {
  imageBytes: number;
  tmdbApiBytes: number;
  anilistApiBytes: number;
  totalBytes: number;
  imageFiles: number;
  tmdbEntries: number;
  anilistEntries: number;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
}

function emptyUsage(): CacheUsageStats {
  return {
    imageBytes: 0,
    tmdbApiBytes: 0,
    anilistApiBytes: 0,
    totalBytes: 0,
    imageFiles: 0,
    tmdbEntries: 0,
    anilistEntries: 0,
  };
}

function parseUsage(raw: unknown): CacheUsageStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Partial<CacheUsageStats>;
  return {
    imageBytes: typeof u.imageBytes === 'number' ? u.imageBytes : 0,
    tmdbApiBytes: typeof u.tmdbApiBytes === 'number' ? u.tmdbApiBytes : 0,
    anilistApiBytes: typeof u.anilistApiBytes === 'number' ? u.anilistApiBytes : 0,
    totalBytes: typeof u.totalBytes === 'number' ? u.totalBytes : 0,
    imageFiles: typeof u.imageFiles === 'number' ? u.imageFiles : 0,
    tmdbEntries: typeof u.tmdbEntries === 'number' ? u.tmdbEntries : 0,
    anilistEntries: typeof u.anilistEntries === 'number' ? u.anilistEntries : 0,
  };
}

export default function StorageSettingsPage() {
  const { settings, loading, update } = useAppSettings();
  const cacheImagesEnabled = settings?.cacheImagesEnabled ?? true;

  const [cacheUsage, setCacheUsage] = useState<CacheUsageStats | null>(null);
  const [cacheStatus, setCacheStatus] = useState<'idle' | 'purging'>('idle');
  const [cacheLastPurgedAt, setCacheLastPurgedAt] = useState<string | null>(null);
  const [loadingCacheUsage, setLoadingCacheUsage] = useState(false);
  const [purgingCache, setPurgingCache] = useState(false);

  const [cleanupSummary, setCleanupSummary] = useState<{ total: number; oldestAt: string | null } | null>(null);
  const [olderThanDays, setOlderThanDays] = useState('30');
  const [confirmOlder, setConfirmOlder] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [deletingHistory, setDeletingHistory] = useState(false);

  const loadCacheUsage = useCallback(async () => {
    if (!cacheImagesEnabled) {
      setCacheUsage(null);
      setCacheStatus('idle');
      return;
    }
    setLoadingCacheUsage(true);
    try {
      const res = await fetch('/api/settings/cache');
      if (!res.ok) return;
      const data = await res.json();
      const usage = parseUsage(data.usage);
      if (usage) setCacheUsage(usage);
      setCacheStatus(data.status === 'purging' ? 'purging' : 'idle');
      setCacheLastPurgedAt(typeof data.lastPurgedAt === 'string' ? data.lastPurgedAt : null);
    } catch {
      // noop
    } finally {
      setLoadingCacheUsage(false);
    }
  }, [cacheImagesEnabled]);

  useEffect(() => {
    if (!cacheImagesEnabled) {
      setCacheUsage(null);
      setCacheStatus('idle');
      return;
    }
    void loadCacheUsage();
    const id = setInterval(() => void loadCacheUsage(), 30_000);
    return () => clearInterval(id);
  }, [cacheImagesEnabled, loadCacheUsage]);

  const loadCleanupSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/cleanup/history?summary=true');
      if (!res.ok) return;
      const data = (await res.json()) as { total?: unknown; oldestAt?: unknown };
      setCleanupSummary({
        total: typeof data.total === 'number' ? data.total : 0,
        oldestAt: typeof data.oldestAt === 'string' ? data.oldestAt : null,
      });
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    void loadCleanupSummary();
  }, [loadCleanupSummary]);

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
    if (!next) {
      // server purges when disabled; reset local view
      setCacheUsage(emptyUsage());
    } else {
      void loadCacheUsage();
    }
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
      const usage = parseUsage(payload?.usage);
      if (usage) setCacheUsage(usage);
      else void loadCacheUsage();
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
      await loadCleanupSummary();
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
          Image cache and cleanup history.
        </p>
      </div>

      <GroupedSection title="Image cache" footer="Synced across devices · Server action affects all clients">
        <div className="grouped-row">
          <span className="text-sm">Cache images</span>
          <Switch
            checked={cacheImagesEnabled}
            onCheckedChange={handleToggleCache}
            disabled={loading}
            aria-label="Cache Images"
          />
        </div>

        {cacheImagesEnabled && (
          <>
            <div className="grouped-row">
              <span className="text-sm">Total usage</span>
              <span className="text-sm text-muted-foreground">
                {loadingCacheUsage ? 'Loading…' : formatBytes(cacheUsage?.totalBytes ?? 0)}
              </span>
            </div>
            <div className="grouped-row">
              <span className="text-sm">Images</span>
              <span className="text-sm text-muted-foreground">
                {loadingCacheUsage
                  ? 'Loading…'
                  : `${formatBytes(cacheUsage?.imageBytes ?? 0)} (${cacheUsage?.imageFiles ?? 0} files)`}
              </span>
            </div>
            <div className="grouped-row">
              <span className="text-sm">TMDB API</span>
              <span className="text-sm text-muted-foreground">
                {loadingCacheUsage
                  ? 'Loading…'
                  : `${formatBytes(cacheUsage?.tmdbApiBytes ?? 0)} (${cacheUsage?.tmdbEntries ?? 0} entries)`}
              </span>
            </div>
            <div className="grouped-row">
              <span className="text-sm">AniList API</span>
              <span className="text-sm text-muted-foreground">
                {loadingCacheUsage
                  ? 'Loading…'
                  : `${formatBytes(cacheUsage?.anilistApiBytes ?? 0)} (${cacheUsage?.anilistEntries ?? 0} entries)`}
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
        )}
      </GroupedSection>

      <GroupedSection title="Cleanup history" footer="Server action — affects all devices">
        <div className="grouped-row">
          <span className="text-sm">Stored rows</span>
          <span className="text-sm text-muted-foreground">
            {cleanupSummary == null
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
              || Number(olderThanDays) < 1
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
