'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Loader2, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAppSettings } from '@/lib/hooks/use-app-settings';
import { jsonFetcher, backoffRefetchInterval } from '@/lib/query-fetch';
import { formatBytes } from '@/lib/format';

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 0) return new Date(iso).toLocaleString();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function hourLabel(h: number): string {
  if (h === 0) return '12:00 AM';
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return '12:00 PM';
  return `${h - 12}:00 PM`;
}

interface AutoMapStatus {
  enabled: boolean;
  hour: number;
  running: boolean;
  run: { processed: number; queueTotal: number; failed: number; currentTitle: string | null } | null;
  mapped: number | null;
  unmatched: number | null;
  neverMapped: number | null;
  total: number | null;
  lastRunAt: string | null;
}

const TTL_FIELDS = [
  { key: 'anilistSectionsTtlMin', label: 'Sections TTL', hint: 'Home / trending rails' },
  { key: 'anilistBrowseTtlMin', label: 'Search & browse TTL', hint: 'Search results, mapping candidates' },
  { key: 'anilistDetailTtlMin', label: 'Detail TTL', hint: 'Anime / staff / character details' },
  { key: 'anilistAiringTtlMin', label: 'Airing TTL', hint: 'Next-episode countdowns, schedule' },
] as const;

type TtlKey = (typeof TTL_FIELDS)[number]['key'];

interface AnilistCacheUsage {
  anilistEntries: number;
  anilistApiBytes: number;
}

/** Humanize a minutes value so "1440" reads as a day. Null below an hour. */
function formatMinutesHint(raw: string | undefined): string | null {
  const minutes = Number.parseInt(raw ?? '', 10);
  if (!Number.isInteger(minutes) || minutes < 60) return null;
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `= ${days} day${days === 1 ? '' : 's'}`;
  }
  if (minutes % 60 === 0) return `= ${minutes / 60} h`;
  return `≈ ${(minutes / 60).toFixed(1)} h`;
}

export default function AnimeMappingsPage() {
  const { settings, update: updateSettings } = useAppSettings();
  const queryClient = useQueryClient();
  const [ttlDraft, setTtlDraft] = useState<Record<TtlKey, string> | null>(null);
  const [savingTtls, setSavingTtls] = useState(false);
  const [confirmClearCache, setConfirmClearCache] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);

  // Nightly auto-map section
  const [runningAutoMap, setRunningAutoMap] = useState(false);
  const [stopping, setStopping] = useState(false);

  const { data: cacheUsageRaw } = useQuery({
    queryKey: ['settings', 'cache'],
    queryFn: jsonFetcher<{ usage?: AnilistCacheUsage }>('/api/settings/cache'),
  });
  const cacheUsage: AnilistCacheUsage | null = cacheUsageRaw?.usage
    ? {
        anilistEntries: cacheUsageRaw.usage.anilistEntries,
        anilistApiBytes: cacheUsageRaw.usage.anilistApiBytes,
      }
    : null;

  const { data: autoMapStatusData } = useQuery({
    queryKey: ['anime-mappings', 'status'],
    queryFn: jsonFetcher<AutoMapStatus>('/api/anime/automap/status'),
  });
  const autoMapStatus = autoMapStatusData ?? null;

  // While a drain is in progress, poll status so progress climbs and the UI
  // flips back to "Run now" once it finishes or is stopped. Pauses when the tab
  // is hidden and catches up on return.
  useQuery({
    queryKey: ['anime-mappings', 'status'],
    queryFn: jsonFetcher<AutoMapStatus>('/api/anime/automap/status'),
    refetchInterval: backoffRefetchInterval(5000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
    enabled: Boolean(autoMapStatus?.running),
  });

  const reloadCacheUsage = () => queryClient.invalidateQueries({ queryKey: ['settings', 'cache'] });
  const reloadAutoMapStatus = () => queryClient.invalidateQueries({ queryKey: ['anime-mappings', 'status'] });

  async function handleRunAutoMapNow() {
    setRunningAutoMap(true);
    try {
      const res = await fetch('/api/anime/automap/run', { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error || 'Failed to start auto-mapping');
        return;
      }
      // Always 200; { started, reason } says whether a run actually began.
      const result = (await res.json()) as { started: boolean; queued?: number; reason?: string };
      if (result.started) {
        toast.success(`Auto-mapping started — ${result.queued} anime queued, one per minute`);
      } else if (result.reason === 'nothing-to-map') {
        toast.info('Nothing to map — every anime already has a mapping');
      } else if (result.reason === 'already-running') {
        toast.info('Auto-mapping is already running');
      } else if (result.reason === 'sonarr-unavailable') {
        toast.error('Sonarr is unavailable');
      } else {
        // Includes 'disabled', which only scheduled runs can hit — a manual
        // Run now is allowed even with the nightly toggle off.
        toast.error('Failed to start auto-mapping');
      }
      void reloadAutoMapStatus();
    } finally {
      setRunningAutoMap(false);
    }
  }

  async function handleStopAutoMap() {
    setStopping(true);
    try {
      const res = await fetch('/api/anime/automap/stop', { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error || 'Failed to stop auto-mapping');
        return;
      }
      const data = (await res.json()) as { stopping: boolean };
      toast.success(data.stopping ? 'Auto-mapping stopped' : 'Auto-mapping already finished');
      void reloadAutoMapStatus();
    } finally {
      setStopping(false);
    }
  }

  useEffect(() => {
    if (!settings || ttlDraft !== null) return;
    setTtlDraft({
      anilistSectionsTtlMin: String(settings.anilistSectionsTtlMin),
      anilistBrowseTtlMin: String(settings.anilistBrowseTtlMin),
      anilistDetailTtlMin: String(settings.anilistDetailTtlMin),
      anilistAiringTtlMin: String(settings.anilistAiringTtlMin),
    });
  }, [settings, ttlDraft]);

  async function handleSaveTtls() {
    if (!ttlDraft) return;
    const patch: Partial<Record<TtlKey, number>> = {};
    for (const field of TTL_FIELDS) {
      const parsed = Number.parseInt(ttlDraft[field.key], 10);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 43_200) {
        toast.error(`${field.label} must be between 1 and 43200 minutes`);
        return;
      }
      patch[field.key] = parsed;
    }
    setSavingTtls(true);
    try {
      await updateSettings(patch);
    } finally {
      setSavingTtls(false);
    }
  }

  async function handleClearAnilistCache() {
    setClearingCache(true);
    try {
      const res = await fetch('/api/settings/cache?provider=anilist', { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error || 'Failed to clear AniList cache');
        return;
      }
      const data = (await res.json()) as { deletedEntries: number; deletedBytes: number };
      toast.success(
        `Cleared ${data.deletedEntries.toLocaleString()} cached response${data.deletedEntries === 1 ? '' : 's'} (${formatBytes(data.deletedBytes)})`
      );
      await reloadCacheUsage();
    } finally {
      setClearingCache(false);
      setConfirmClearCache(false);
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
        <h1 className="text-2xl font-semibold">Anime mappings</h1>
      </div>

      <GroupedSection>
        <Link
          href="/settings/anime-mappings/mapping-list"
          className="grouped-row hover:bg-[oklch(1_0_0/3%)] active:bg-white/5 transition-colors"
        >
          <div className="min-w-0">
            <span className="text-sm font-medium">Mapping list</span>
            <p className="text-[11px] text-muted-foreground">View &amp; reset individual AniList links</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </Link>
      </GroupedSection>

      <GroupedSection
        title="Auto-mapping"
        footer="Each night, anime in Sonarr that were never mapped get auto-linked to AniList — one per minute to stay under AniList's rate limit. Already auto-mapped and manually-set series are left alone. Turning this off skips future nightly runs; use Stop to halt one in progress."
      >
        <div className="grouped-row">
          <span className="text-sm">Nightly auto-map</span>
          <Switch
            checked={settings?.animeAutoMapEnabled ?? true}
            onCheckedChange={(next) => void updateSettings({ animeAutoMapEnabled: next })}
            disabled={!settings}
          />
        </div>
        {(settings?.animeAutoMapEnabled ?? true) && (
          <div className="grouped-row">
            <span className="text-sm">Run at</span>
            <Select
              value={String(settings?.animeAutoMapHour ?? 0)}
              onValueChange={(v) => void updateSettings({ animeAutoMapHour: Number.parseInt(v, 10) })}
              disabled={!settings}
            >
              <SelectTrigger className="h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, i) => (
                  <SelectItem key={i} value={String(i)}>{hourLabel(i)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grouped-row">
          <span className="text-sm">Mapped</span>
          <div className="text-right">
            <span className="text-sm text-muted-foreground">
              {autoMapStatus ? `${autoMapStatus.mapped ?? '—'} / ${autoMapStatus.total ?? '—'}` : '—'}
            </span>
            {autoMapStatus && ((autoMapStatus.neverMapped ?? 0) > 0 || (autoMapStatus.unmatched ?? 0) > 0) && (
              <p className="text-[11px] text-muted-foreground">
                {[
                  (autoMapStatus.neverMapped ?? 0) > 0 ? `${autoMapStatus.neverMapped} never mapped` : null,
                  (autoMapStatus.unmatched ?? 0) > 0 ? `${autoMapStatus.unmatched} unmatched` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        </div>
        {autoMapStatus?.lastRunAt && (
          <div className="grouped-row">
            <span className="text-sm">Last run</span>
            <span className="text-sm text-muted-foreground">{relativeTime(autoMapStatus.lastRunAt)}</span>
          </div>
        )}
        {autoMapStatus?.running ? (
          <div className="px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                <span className="truncate">
                  {autoMapStatus.run?.currentTitle ? `Mapping ${autoMapStatus.run.currentTitle}` : 'Mapping…'}
                </span>
              </span>
              <span className="shrink-0 text-muted-foreground">
                {autoMapStatus.run
                  ? `${autoMapStatus.run.queueTotal - autoMapStatus.run.processed} remaining${autoMapStatus.run.failed > 0 ? ` · ${autoMapStatus.run.failed} failed` : ''
                  }`
                  : ''}
              </span>
            </div>
            {autoMapStatus.run && autoMapStatus.run.queueTotal > 0 && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${Math.round((autoMapStatus.run.processed / autoMapStatus.run.queueTotal) * 100)}%`,
                  }}
                />
              </div>
            )}
            <Button
              variant="outline"
              className="h-9 w-full text-destructive hover:text-destructive"
              onClick={handleStopAutoMap}
              disabled={stopping}
            >
              {stopping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
              Stop
            </Button>
          </div>
        ) : (
          <div className="px-4 py-3">
            <Button
              variant="outline"
              className="h-9 w-full"
              onClick={handleRunAutoMapNow}
              disabled={runningAutoMap}
            >
              {runningAutoMap ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Run now
            </Button>
          </div>
        )}
      </GroupedSection>

      <GroupedSection
        title="AniList cache"
        footer="TTLs apply to new fetches; stale-serve windows scale automatically. Clearing removes only AniList API responses — images and TMDB stay."
      >
        <div className="grouped-row">
          <span className="text-sm">Cached responses</span>
          <span className="text-sm text-muted-foreground">
            {cacheUsage
              ? `${cacheUsage.anilistEntries.toLocaleString()} · ${formatBytes(cacheUsage.anilistApiBytes)}`
              : '—'}
          </span>
        </div>
        {TTL_FIELDS.map((field) => {
          const hint = formatMinutesHint(ttlDraft?.[field.key]);
          return (
            <div key={field.key} className="grouped-row gap-3">
              <div className="min-w-0">
                <span className="text-sm">{field.label}</span>
                <p className="text-[11px] text-muted-foreground truncate">{field.hint}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Input
                  type="number"
                  min={1}
                  max={43200}
                  value={ttlDraft?.[field.key] ?? ''}
                  onChange={(event) =>
                    setTtlDraft((prev) => (prev ? { ...prev, [field.key]: event.target.value } : prev))
                  }
                  disabled={ttlDraft === null}
                  className="h-8 w-24 text-right"
                />
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  min{hint ? ` (${hint})` : ''}
                </span>
              </div>
            </div>
          );
        })}
        <div className="flex gap-2 px-4 py-3">
          <Button
            variant="outline"
            className="h-9 flex-1"
            onClick={handleSaveTtls}
            disabled={savingTtls || ttlDraft === null}
          >
            {savingTtls ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save TTLs
          </Button>
          <Button
            variant="outline"
            className="h-9 flex-1 text-destructive hover:text-destructive"
            onClick={() => setConfirmClearCache(true)}
            disabled={clearingCache}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Clear AniList cache
          </Button>
        </div>
      </GroupedSection>

      <ConfirmDialog
        open={confirmClearCache}
        onOpenChange={setConfirmClearCache}
        title="Clear the AniList cache?"
        description="All cached AniList API responses are deleted and refetch on demand. Images and TMDB caches are not touched."
        confirmLabel="Clear"
        destructive
        busy={clearingCache}
        onConfirm={handleClearAnilistCache}
      />
    </div>
  );
}
