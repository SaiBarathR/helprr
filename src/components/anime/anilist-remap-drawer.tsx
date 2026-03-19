'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Search, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type {
  SeriesAniListCandidate,
  SeriesAniListMapping,
  SeriesAniListResponse,
} from '@/types/anilist';

interface AniListRemapDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seriesId: number;
  seriesTitle: string;
  mapping: SeriesAniListMapping | null;
  onUpdated: (response: SeriesAniListResponse) => void;
}

interface CandidateResponse {
  query: string;
  items: SeriesAniListCandidate[];
}

function formatState(mapping: SeriesAniListMapping | null): string {
  if (!mapping) return 'No mapping';
  if (mapping.state === 'MANUAL_MATCH') return 'Manual match';
  if (mapping.state === 'MANUAL_NONE') return 'Manually unmapped';
  if (mapping.state === 'AUTO_MATCH') return 'Auto matched';
  return 'Auto unmatched';
}

export function AniListRemapDrawer({
  open,
  onOpenChange,
  seriesId,
  seriesTitle,
  mapping,
  onUpdated,
}: AniListRemapDrawerProps) {
  const [query, setQuery] = useState(seriesTitle);
  const [results, setResults] = useState<SeriesAniListCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setResults([]);
      setLoading(false);
      return;
    }
    setResults([]);
    setLoading(false);
    setError(null);
    setQuery(seriesTitle);
  }, [open, seriesTitle]);

  const trimmedQuery = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    setResults([]);
    const handle = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (trimmedQuery) params.set('q', trimmedQuery);
        const res = await fetch(`/api/sonarr/${seriesId}/anime/candidates?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to load AniList candidates');
        }

        const data: CandidateResponse = await res.json();
        setResults(data.items);
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return;
        setResults([]);
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to load AniList candidates');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [open, seriesId, trimmedQuery]);

  async function handleSelect(anilistMediaId: number) {
    setSavingId(anilistMediaId);
    setError(null);
    try {
      const res = await fetch(`/api/sonarr/${seriesId}/anime`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anilistMediaId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save AniList mapping');
      }

      onUpdated(data as SeriesAniListResponse);
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save AniList mapping');
    } finally {
      setSavingId(null);
    }
  }

  async function handleClear() {
    setClearing(true);
    setError(null);
    try {
      const res = await fetch(`/api/sonarr/${seriesId}/anime`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to clear AniList mapping');
      }

      onUpdated(data as SeriesAniListResponse);
      onOpenChange(false);
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : 'Failed to clear AniList mapping');
    } finally {
      setClearing(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="text-center">
          <DrawerTitle>Remap AniList</DrawerTitle>
          <DrawerDescription>
            Search AniList and attach the correct anime entry to this Sonarr series.
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-2 space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              value={query}
              onChange={(event) => {
                setResults([]);
                setLoading(false);
                setError(null);
                setQuery(event.target.value);
              }}
              placeholder="Search AniList"
              className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{seriesTitle}</p>
              <p className="text-xs text-muted-foreground">{formatState(mapping)}</p>
            </div>
            {mapping?.state === 'MANUAL_MATCH' ? (
              <Badge className="bg-green-600/90 text-white">Manual</Badge>
            ) : mapping?.state === 'AUTO_MATCH' ? (
              <Badge variant="outline">Auto</Badge>
            ) : null}
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="max-h-[52vh] overflow-y-auto space-y-2 pb-2">
            {loading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex gap-3 rounded-lg border border-border/30 p-3">
                  <Skeleton className="h-[84px] w-[56px] rounded-md shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              ))
            ) : results.length > 0 ? (
              results.map((candidate) => {
                const coverSrc = candidate.coverImage
                  ? toCachedImageSrc(candidate.coverImage, 'anilist') || candidate.coverImage
                  : null;
                const isCurrent = mapping?.anilistMediaId === candidate.id;

                return (
                  <button
                    key={candidate.id}
                    onClick={() => handleSelect(candidate.id)}
                    disabled={savingId !== null || clearing}
                    className="flex w-full gap-3 rounded-lg border border-border/30 bg-muted/10 p-3 text-left active:bg-muted/30 disabled:opacity-60"
                  >
                    <div className="relative h-[84px] w-[56px] shrink-0 overflow-hidden rounded-md bg-muted">
                      {coverSrc ? (
                        <Image
                          src={coverSrc}
                          alt={candidate.title}
                          fill
                          sizes="56px"
                          className="object-cover"
                          unoptimized={isProtectedApiImageSrc(coverSrc)}
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium line-clamp-2">{candidate.title}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {[candidate.format?.replace('_', ' '), candidate.seasonYear].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        {savingId === candidate.id ? (
                          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                        ) : isCurrent ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                        {candidate.averageScore != null && (
                          <Badge variant="outline" className="text-[10px]">
                            {candidate.averageScore}%
                          </Badge>
                        )}
                        {candidate.episodes != null && (
                          <Badge variant="outline" className="text-[10px]">
                            {candidate.episodes} eps
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-[10px]">
                          Match {candidate.matchScore}
                        </Badge>
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-lg border border-border/30 bg-muted/10 px-3 py-8 text-center text-sm text-muted-foreground">
                No AniList candidates found.
              </div>
            )}
          </div>
        </div>

        <DrawerFooter>
          <Button
            variant="outline"
            onClick={handleClear}
            disabled={clearing || savingId !== null}
            className="w-full"
          >
            {clearing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Clearing...
              </>
            ) : (
              <>
                <XCircle className="mr-2 h-4 w-4" />
                Clear Mapping
              </>
            )}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
