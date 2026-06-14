'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Loader2, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { jsonFetcher, ApiError } from '@/lib/query-fetch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Input } from '@/components/ui/input';
import type {
  AdminAnimeMappingRow,
  AdminAnimeMappingsResponse,
  SeriesAniListMappingState,
} from '@/types/anilist';

const STATE_META: Record<SeriesAniListMappingState, { label: string; className: string }> = {
  AUTO_MATCH: { label: 'Auto', className: 'bg-emerald-500/15 text-emerald-400' },
  MANUAL_MATCH: { label: 'Manual', className: 'bg-sky-500/15 text-sky-400' },
  AUTO_UNMATCHED: { label: 'Unmatched', className: 'bg-amber-500/15 text-amber-400' },
  MANUAL_NONE: { label: 'Cleared', className: 'bg-zinc-500/15 text-zinc-400' },
};

type StateFilter = 'ALL' | SeriesAniListMappingState;

const FILTERS: Array<{ value: StateFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'AUTO_MATCH', label: 'Auto' },
  { value: 'MANUAL_MATCH', label: 'Manual' },
  { value: 'AUTO_UNMATCHED', label: 'Unmatched' },
  { value: 'MANUAL_NONE', label: 'Cleared' },
];

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

function entryLabel(entry: AdminAnimeMappingRow['entries'][number]): string {
  const title = entry.titleSnapshot ?? `AniList #${entry.anilistMediaId}`;
  return entry.isPrimary ? `★ ${title}` : title;
}

export default function AnimeMappingListPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<StateFilter>('ALL');
  const [search, setSearch] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<AdminAnimeMappingRow | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const {
    data: mappings = null,
    isError,
    error: queryError,
  } = useQuery({
    queryKey: ['anime-mappings'],
    queryFn: jsonFetcher<AdminAnimeMappingsResponse>('/api/settings/anime-mappings'),
    select: (data) => data.mappings,
  });
  const error = isError
    ? queryError instanceof ApiError
      ? `HTTP ${queryError.status}`
      : queryError instanceof Error
        ? queryError.message
        : 'Failed to load mappings'
    : null;

  const counts = useMemo(() => {
    const all = mappings ?? [];
    const byState = { AUTO_MATCH: 0, MANUAL_MATCH: 0, AUTO_UNMATCHED: 0, MANUAL_NONE: 0 };
    for (const row of all) byState[row.state] += 1;
    return { total: all.length, ...byState };
  }, [mappings]);

  const filtered = useMemo(() => {
    const all = mappings ?? [];
    const query = search.trim().toLowerCase();
    return all.filter((row) => {
      if (filter !== 'ALL' && row.state !== filter) return false;
      if (query && !row.seriesTitle.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [mappings, filter, search]);

  // Show the instance label only when mappings span more than one Sonarr instance,
  // so the same series id on two instances is distinguishable.
  const multiInstance = useMemo(
    () => new Set((mappings ?? []).map((row) => row.sonarrInstanceId)).size > 1,
    [mappings]
  );

  // Virtualize the row list (bounded by Sonarr library size, but can be a few
  // thousand) so we never mount thousands of DOM nodes. Filtering/search/counts
  // stay client-side over the full set — only rendering is windowed. Dynamic-height
  // pattern (measureElement) mirrors the logs page.
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const handleListRef = useCallback((node: HTMLDivElement | null) => {
    listRef.current = node;
    if (node) setScrollMargin(node.getBoundingClientRect().top + window.scrollY);
  }, []);
  useEffect(() => {
    const onResize = () => {
      if (listRef.current) setScrollMargin(listRef.current.getBoundingClientRect().top + window.scrollY);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const rowVirtualizer = useWindowVirtualizer({
    count: filtered.length,
    estimateSize: () => 84,
    enabled: filtered.length > 0,
    overscan: 8,
    scrollMargin,
  });

  const resetOneMutation = useMutation({
    mutationFn: async (row: AdminAnimeMappingRow) => {
      const res = await fetch(`/api/settings/anime-mappings/${row.sonarrSeriesId}?instanceId=${row.sonarrInstanceId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'Failed to reset mapping');
      }
    },
    onSuccess: (_data, row) => {
      toast.success(`Reset ${row.seriesTitle}`);
      queryClient.invalidateQueries({ queryKey: ['anime-mappings'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to reset mapping'),
    onSettled: () => setConfirmTarget(null),
  });

  const resetAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings/anime-mappings', { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'Failed to reset mappings');
      }
      return (await res.json()) as { deleted: number };
    },
    onSuccess: (data) => {
      toast.success(`Reset ${data.deleted} mapping${data.deleted === 1 ? '' : 's'}`);
      queryClient.invalidateQueries({ queryKey: ['anime-mappings'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to reset mappings'),
    onSettled: () => setConfirmAll(false),
  });

  const busy = resetOneMutation.isPending || resetAllMutation.isPending;

  function handleResetOne(row: AdminAnimeMappingRow) {
    return resetOneMutation.mutateAsync(row).catch(() => {});
  }

  function handleResetAll() {
    return resetAllMutation.mutateAsync().catch(() => {});
  }

  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link
          href="/settings/anime-mappings"
          className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1"
        >
          <ChevronLeft className="h-5 w-5" />
          Anime mappings
        </Link>
      </div>

      {error && (
        <GroupedSection>
          <div className="px-4 py-3 text-sm text-red-400">{error}</div>
        </GroupedSection>
      )}

      {mappings === null && !error ? (
        <GroupedSection >
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Loading mappings…
          </div>
        </GroupedSection>
      ) : mappings !== null ? (
        <>
          <div className="px-4 mb-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter by series title"
              // className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              />
              {counts.total > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 h-9 text-destructive hover:text-destructive"
                  onClick={() => setConfirmAll(true)}
                  disabled={busy}
                >
                  <Trash2 className="h-4 w-4 sm:mr-1.5" />
                  <span className="hidden sm:inline">Reset all</span>
                </Button>
              )}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {FILTERS.map((item) => {
                const count =
                  item.value === 'ALL' ? counts.total : counts[item.value as SeriesAniListMappingState];
                return (
                  <button
                    key={item.value}
                    onClick={() => setFilter(item.value)}
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${filter === item.value
                      ? 'border-primary/50 bg-primary/15 text-primary'
                      : 'border-border/40 bg-muted/20 text-muted-foreground'
                      }`}
                  >
                    {item.label} · {count}
                  </button>
                );
              })}
            </div>
          </div>

          {filtered.length === 0 ? (
            <GroupedSection>
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                {counts.total === 0
                  ? 'No mappings yet — they appear as anime series pages are viewed.'
                  : 'No mappings match the current filter.'}
              </div>
            </GroupedSection>
          ) : (
            <div className="grouped-section mb-6">
              <div className="grouped-section-title">{`${filtered.length} of ${counts.total}`}</div>
              <div
                ref={handleListRef}
                className="grouped-section-content relative w-full"
                style={{ height: rowVirtualizer.getTotalSize() }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                  const row = filtered[virtualItem.index];
                  const autoCount = row.entries.filter((entry) => entry.source === 'auto').length;
                  return (
                    <div
                      key={`${row.sonarrInstanceId}:${row.sonarrSeriesId}`}
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualItem.index}
                      className="grouped-row gap-2"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start - rowVirtualizer.options.scrollMargin}px)`,
                      }}
                    >
                      <button
                        onClick={() => router.push(`/series/${row.sonarrSeriesId}?instance=${row.sonarrInstanceId}`)}
                        className="flex-1 min-w-0 py-2 text-left"
                      >
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="text-sm font-medium truncate">{row.seriesTitle}</span>
                          {row.seriesYear != null && (
                            <span className="text-xs text-muted-foreground shrink-0">{row.seriesYear}</span>
                          )}
                          {multiInstance && (
                            <span className="text-[10px] text-muted-foreground shrink-0 rounded bg-muted px-1.5 py-0.5">
                              {row.sonarrInstanceLabel}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Badge className={`${STATE_META[row.state].className} text-[10px] px-1.5 py-0`}>
                            {STATE_META[row.state].label}
                          </Badge>
                          {row.entries.length > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                              {row.entries.length} linked
                              {autoCount > 0 ? ` · ${autoCount} auto` : ''}
                            </span>
                          )}
                          {row.confidence != null && (
                            <span className="text-[11px] text-muted-foreground">conf {row.confidence}</span>
                          )}
                          <span className="text-[11px] text-muted-foreground">{relativeTime(row.resolvedAt)}</span>
                        </div>
                        {row.entries.length > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground truncate">
                            {row.entries.map(entryLabel).join(' · ')}
                          </p>
                        )}
                      </button>
                      <button
                        onClick={() => setConfirmTarget(row)}
                        disabled={busy}
                        aria-label={`Reset mapping for ${row.seriesTitle}`}
                        className="self-center min-w-[36px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-destructive disabled:opacity-60"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : null}

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
        title={confirmTarget ? `Reset ${confirmTarget.seriesTitle}?` : 'Reset mapping?'}
        description="All AniList links for this series are forgotten — including manual ones. It re-auto-matches the next time someone views it."
        confirmLabel="Reset"
        destructive
        busy={busy}
        onConfirm={() => (confirmTarget ? handleResetOne(confirmTarget) : Promise.resolve())}
      />

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={`Reset all ${counts.total} mappings?`}
        description="Every AniList link is forgotten — auto and manual alike. Each anime series re-auto-matches with season auto-linking the next time it's viewed."
        confirmLabel="Reset all"
        destructive
        busy={busy}
        onConfirm={async () => {
          await handleResetAll();
        }}
      />
    </div>
  );
}
