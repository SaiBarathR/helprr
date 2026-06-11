'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Search, Loader2, CheckCircle2, XCircle, Tv } from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { getImageUrl } from '@/components/media/media-card';
import { isProtectedApiImageSrc } from '@/lib/image';
import type { SonarrSeriesListItem } from '@/types';
import type { AnimeSonarrMappingItem, AnimeSonarrMappingsResponse } from '@/types/anilist';

interface SonarrMapDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anilistMediaId: number;
  animeTitle: string;
  /** Library-matched Sonarr series id — lets the reverse lookup lazily resolve a never-viewed series' mapping. */
  sonarrSeriesHint?: number | null;
  /** Fired whenever this anime's Sonarr mappings change (and on open-load) so the page row stays in sync. */
  onMappingsChanged?: (mappings: AnimeSonarrMappingItem[]) => void;
}

export function SonarrMapDrawer({
  open,
  onOpenChange,
  anilistMediaId,
  animeTitle,
  sonarrSeriesHint,
  onMappingsChanged,
}: SonarrMapDrawerProps) {
  const [query, setQuery] = useState('');
  const [seriesList, setSeriesList] = useState<SonarrSeriesListItem[]>([]);
  const [mappings, setMappings] = useState<AnimeSonarrMappingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [clearingId, setClearingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    setQuery('');
    setError(null);
    setLoading(true);

    const hint = sonarrSeriesHint != null ? `?sonarrSeriesId=${sonarrSeriesHint}` : '';
    Promise.all([
      fetch('/api/sonarr', { signal: controller.signal })
        .then((r) => (r.ok ? r.json() as Promise<SonarrSeriesListItem[]> : Promise.reject(new Error('Failed to load Sonarr series')))),
      fetch(`/api/anime/${anilistMediaId}/sonarr${hint}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() as Promise<AnimeSonarrMappingsResponse> : Promise.reject(new Error('Failed to load current mappings')))),
    ])
      .then(([series, mappingsData]) => {
        setSeriesList(series.filter((item) => item.seriesType === 'anime'));
        setMappings(mappingsData.mappings);
        onMappingsChanged?.(mappingsData.mappings);
      })
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return;
        setSeriesList([]);
        setMappings([]);
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to load Sonarr series');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
    // onMappingsChanged is a state setter from the page — stable by contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, anilistMediaId, sonarrSeriesHint]);

  const mappedIds = useMemo(
    () => new Set(mappings.map((m) => m.sonarrSeriesId)),
    [mappings]
  );

  const trimmedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const items = trimmedQuery
      ? seriesList.filter((item) => item.title.toLowerCase().includes(trimmedQuery))
      : seriesList;
    return [...items].sort((a, b) => a.sortTitle.localeCompare(b.sortTitle));
  }, [seriesList, trimmedQuery]);
  // Mapped series render in their own labeled section so the current state is obvious.
  const mappedItems = useMemo(() => filtered.filter((item) => mappedIds.has(item.id)), [filtered, mappedIds]);
  const unmappedItems = useMemo(() => filtered.filter((item) => !mappedIds.has(item.id)), [filtered, mappedIds]);

  async function handleSelect(item: SonarrSeriesListItem) {
    setSavingId(item.id);
    setError(null);
    try {
      const res = await fetch(`/api/sonarr/${item.id}/anime${item.instanceId ? `?instanceId=${item.instanceId}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anilistMediaId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save AniList mapping');
      }

      const next: AnimeSonarrMappingItem[] = [
        ...mappings.filter((m) => m.sonarrSeriesId !== item.id),
        { sonarrInstanceId: item.instanceId ?? '', sonarrSeriesId: item.id, state: 'MANUAL_MATCH', seriesTitle: item.title, seriesYear: item.year ?? null },
      ];
      setMappings(next);
      onMappingsChanged?.(next);
      toast.success('AniList mapping updated');
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save AniList mapping');
    } finally {
      setSavingId(null);
    }
  }

  async function handleClear(seriesId: number) {
    setClearingId(seriesId);
    setError(null);
    try {
      const res = await fetch(`/api/sonarr/${seriesId}/anime?anilistMediaId=${anilistMediaId}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to clear AniList mapping');
      }

      const next = mappings.filter((m) => m.sonarrSeriesId !== seriesId);
      setMappings(next);
      onMappingsChanged?.(next);
      toast.success('AniList mapping cleared');
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : 'Failed to clear AniList mapping');
    } finally {
      setClearingId(null);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="text-center">
          <DrawerTitle>Map to Sonarr</DrawerTitle>
          <DrawerDescription>
            Attach {animeTitle} to an anime series in your Sonarr library.
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-4 space-y-3 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter Sonarr anime series"
              className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pb-2">
            {loading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex gap-3 rounded-lg border border-border/30 p-3">
                  <Skeleton className="h-[84px] w-[56px] rounded-md shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))
            ) : filtered.length > 0 ? (
              <>
                {mappedItems.length > 0 && (
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mapped</p>
                )}
                {[...mappedItems, ...unmappedItems].map((item, index) => {
                const posterSrc = getImageUrl(item.images, 'poster', 'sonarr');
                const isMapped = mappedIds.has(item.id);
                const mapping = mappings.find((m) => m.sonarrSeriesId === item.id);
                const sectionBreak = mappedItems.length > 0 && index === mappedItems.length;

                return (
                  <div key={item.id}>
                  {sectionBreak && (
                    <p className="pt-2 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      All anime series
                    </p>
                  )}
                  <div
                    className="flex w-full gap-3 rounded-lg border border-border/30 bg-muted/10 p-3 text-left"
                  >
                    <button
                      onClick={() => handleSelect(item)}
                      disabled={savingId !== null || clearingId !== null}
                      className="flex min-w-0 flex-1 gap-3 text-left active:opacity-70 disabled:opacity-60"
                    >
                      <div className="relative h-[84px] w-[56px] shrink-0 overflow-hidden rounded-md bg-muted">
                        {posterSrc ? (
                          <Image
                            src={posterSrc}
                            alt={item.title}
                            fill
                            sizes="56px"
                            className="object-cover"
                            unoptimized={isProtectedApiImageSrc(posterSrc)}
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                            <Tv className="h-5 w-5" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium line-clamp-2">{item.title}</p>
                            <p className="text-xs text-muted-foreground truncate">{item.year || ''}</p>
                          </div>
                          {savingId === item.id ? (
                            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                          ) : isMapped ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                          ) : null}
                        </div>
                        {isMapped && (
                          <Badge
                            className={`mt-2 text-[10px] ${mapping?.state === 'MANUAL_MATCH' ? 'bg-green-600/90 text-foreground' : ''}`}
                            variant={mapping?.state === 'MANUAL_MATCH' ? 'default' : 'outline'}
                          >
                            {mapping?.state === 'MANUAL_MATCH' ? 'Manual match' : 'Auto matched'}
                          </Badge>
                        )}
                      </div>
                    </button>
                    {isMapped && (
                      <button
                        onClick={() => handleClear(item.id)}
                        disabled={savingId !== null || clearingId !== null}
                        aria-label={`Unmap ${item.title}`}
                        className="self-center min-w-[36px] min-h-[44px] flex items-center justify-center text-muted-foreground disabled:opacity-60"
                      >
                        {clearingId === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <XCircle className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                  </div>
                );
              })}
              </>
            ) : (
              <div className="rounded-lg border border-border/30 bg-muted/10 px-3 py-8 text-center text-sm text-muted-foreground">
                No anime series found in Sonarr.
              </div>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
