'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Search, Loader2, Plus, X, Star, Trash2 } from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/media/search-input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { ACCEPTABLE_SERIES_FORMATS } from '@/lib/anilist-helpers';
import { isSeasonSibling, normalizeBaseTitle } from '@/lib/anilist-title-match';
import type {
  AniListDetailResponse,
  AniListMediaFormat,
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
  details: AniListDetailResponse[];
  onUpdated: (response: SeriesAniListResponse) => void;
}

interface CandidateResponse {
  query: string;
  items: SeriesAniListCandidate[];
}

// One suggestion row, whether it came from a linked entry's AniList relations
// (has relationType) or from the primary's base-title search (no relationType).
interface SeasonSuggestion {
  id: number;
  title: string;
  coverImage: string | null;
  format: AniListMediaFormat | null;
  seasonYear: number | null;
  relationType?: string;
}

function cover(src: string | null): string | null {
  if (!src) return null;
  return toCachedImageSrc(src, 'anilist') || src;
}

export function AniListRemapDrawer({
  open,
  onOpenChange,
  seriesId,
  seriesTitle,
  mapping,
  details,
  onUpdated,
}: AniListRemapDrawerProps) {
  const [query, setQuery] = useState(seriesTitle);
  const [results, setResults] = useState<SeriesAniListCandidate[]>([]);
  const [seasonCandidates, setSeasonCandidates] = useState<SeriesAniListCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
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

  const entries = useMemo(() => mapping?.entries ?? [], [mapping]);
  const linkedIds = useMemo(() => new Set(entries.map((entry) => entry.anilistMediaId)), [entries]);
  const detailById = useMemo(() => {
    const map = new Map<number, AniListDetailResponse>();
    for (const detail of details) map.set(detail.id, detail);
    return map;
  }, [details]);

  // Season-pattern candidates from one base-title search of the primary.
  // Relations only reach one hop (S1 suggests S2 but never S3/S4); the search
  // surfaces the whole "{base} Season {N}" family in one cached request.
  const primaryId = details[0]?.id ?? null;
  const primaryTitle = details[0]?.title ?? null;
  useEffect(() => {
    if (!open || primaryId == null) {
      setSeasonCandidates([]);
      return;
    }
    const base = normalizeBaseTitle(primaryTitle);
    if (!base) {
      setSeasonCandidates([]);
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        const params = new URLSearchParams({ q: base });
        const res = await fetch(`/api/sonarr/${seriesId}/anime/candidates?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data: CandidateResponse = await res.json();
        setSeasonCandidates(data.items);
      } catch {
        // Suggestions are best-effort; the manual search section still works.
      }
    })();

    return () => controller.abort();
  }, [open, seriesId, primaryId, primaryTitle]);

  // Related seasons surfaced from each linked entry's AniList relations
  // (SEQUEL/PREQUEL/etc.) merged with season-pattern search matches.
  // One-tap adds, so chaining S1 → S2 → S3 is easy.
  const suggestions = useMemo(() => {
    const map = new Map<number, SeasonSuggestion>();
    for (const detail of details) {
      for (const relation of detail.relations) {
        if (relation.type !== 'ANIME') continue;
        if (relation.format && !ACCEPTABLE_SERIES_FORMATS.has(relation.format)) continue;
        if (linkedIds.has(relation.id)) continue;
        if (!map.has(relation.id)) {
          map.set(relation.id, {
            id: relation.id,
            title: relation.title,
            coverImage: relation.coverImage,
            format: relation.format,
            seasonYear: relation.seasonYear,
            relationType: relation.relationType,
          });
        }
      }
    }

    const primary = details[0];
    if (primary) {
      const primaryInput = {
        titles: [primary.title, primary.titleRomaji, primary.titleNative],
        year: primary.seasonYear ?? primary.year,
      };
      for (const candidate of seasonCandidates) {
        if (linkedIds.has(candidate.id) || map.has(candidate.id)) continue;
        const candidateInput = {
          titles: [candidate.title, candidate.titleRomaji, candidate.titleNative],
          year: candidate.seasonYear,
        };
        if (!isSeasonSibling(primaryInput, candidateInput)) continue;
        map.set(candidate.id, {
          id: candidate.id,
          title: candidate.title,
          coverImage: candidate.coverImage,
          format: candidate.format,
          seasonYear: candidate.seasonYear,
        });
      }
    }

    // Rank season continuations first — a title containing "Season" (e.g.
    // "... Season 2" or "2nd Season") is almost always the entry you want to link,
    // so it sorts above OVAs / side-stories / movies. Other season markers,
    // sequel/prequel relation, and TV format break ties; then earliest year first.
    const score = (item: SeasonSuggestion): number => {
      const title = item.title.toLowerCase();
      let s = 0;
      if (/\bseasons?\b/.test(title)) s += 100;
      if (/\bpart\b|\bcour\b|\b\d+(?:st|nd|rd|th)\b|\b(?:ii|iii|iv)\b/.test(title)) s += 30;
      const relationType = (item.relationType || '').toUpperCase();
      if (relationType === 'SEQUEL' || relationType === 'PREQUEL') s += 20;
      else if (relationType === 'PARENT' || relationType === 'SIDE_STORY' || relationType === 'ALTERNATIVE') s += 8;
      if (item.format === 'TV' || item.format === 'TV_SHORT') s += 5;
      return s;
    };

    return Array.from(map.values()).sort((a, b) => {
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      return (a.seasonYear ?? Infinity) - (b.seasonYear ?? Infinity);
    });
  }, [details, linkedIds, seasonCandidates]);

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

  async function mutate(
    init: RequestInit & { url?: string },
    trackingId: number
  ) {
    setBusyId(trackingId);
    setError(null);
    try {
      const res = await fetch(init.url ?? `/api/sonarr/${seriesId}/anime`, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update AniList mapping');
      }
      onUpdated(data as SeriesAniListResponse);
    } catch (mutateError) {
      setError(mutateError instanceof Error ? mutateError.message : 'Failed to update AniList mapping');
    } finally {
      setBusyId(null);
    }
  }

  const addEntry = (anilistMediaId: number) =>
    mutate(
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anilistMediaId }),
      },
      anilistMediaId
    );

  const removeEntry = (anilistMediaId: number) =>
    mutate(
      { method: 'DELETE', url: `/api/sonarr/${seriesId}/anime?anilistMediaId=${anilistMediaId}` },
      anilistMediaId
    );

  const makePrimary = (anilistMediaId: number) =>
    mutate(
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryId: anilistMediaId }),
      },
      anilistMediaId
    );

  async function handleClearAll() {
    setClearing(true);
    setError(null);
    try {
      const res = await fetch(`/api/sonarr/${seriesId}/anime`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to clear AniList mapping');
      }
      onUpdated(data as SeriesAniListResponse);
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : 'Failed to clear AniList mapping');
    } finally {
      setClearing(false);
    }
  }

  const busy = busyId !== null || clearing;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="text-center">
          <DrawerTitle>Linked AniList seasons</DrawerTitle>
          <DrawerDescription>
            Link every AniList entry for {seriesTitle}. The primary shows first on the series page.
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-2 space-y-4 flex-1 min-h-0 flex flex-col overflow-y-auto">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Linked entries */}
          {entries.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Linked</p>
              {entries.map((entry) => {
                const detail = detailById.get(entry.anilistMediaId);
                const coverSrc = cover(detail?.coverImage ?? null);
                return (
                  <div
                    key={entry.anilistMediaId}
                    className="flex gap-3 rounded-lg border border-border/30 bg-muted/10 p-3"
                  >
                    <div className="relative h-[72px] w-[48px] shrink-0 overflow-hidden rounded-md bg-muted">
                      {coverSrc && (
                        <Image
                          src={coverSrc}
                          alt={detail?.title ?? ''}
                          fill
                          sizes="48px"
                          className="object-cover"
                          unoptimized={isProtectedApiImageSrc(coverSrc)}
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium line-clamp-2">
                        {detail?.title ?? entry.titleSnapshot ?? `AniList #${entry.anilistMediaId}`}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[detail?.format?.replace('_', ' '), detail?.seasonYear].filter(Boolean).join(' · ')}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        {entry.isPrimary ? (
                          <Badge className="bg-[var(--hpr-amber)]/20 text-[var(--hpr-amber)] text-[10px] px-1.5 py-0">
                            <Star className="mr-1 h-2.5 w-2.5 fill-current" />
                            Primary
                          </Badge>
                        ) : (
                          <button
                            onClick={() => makePrimary(entry.anilistMediaId)}
                            disabled={busy}
                            className="text-[11px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-60"
                          >
                            Make primary
                          </button>
                        )}
                        {entry.source === 'auto' && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                            Auto
                          </Badge>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => removeEntry(entry.anilistMediaId)}
                      disabled={busy}
                      aria-label="Remove season"
                      className="self-center min-w-[36px] min-h-[44px] flex items-center justify-center text-muted-foreground disabled:opacity-60"
                    >
                      {busyId === entry.anilistMediaId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Suggested seasons (from AniList relations) */}
          {suggestions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Suggested seasons</p>
              {suggestions.map((relation) => {
                const coverSrc = cover(relation.coverImage);
                return (
                  <button
                    key={relation.id}
                    onClick={() => addEntry(relation.id)}
                    disabled={busy}
                    className="flex w-full gap-3 rounded-lg border border-border/30 bg-muted/10 p-3 text-left active:bg-muted/30 disabled:opacity-60"
                  >
                    <div className="relative h-[72px] w-[48px] shrink-0 overflow-hidden rounded-md bg-muted">
                      {coverSrc && (
                        <Image
                          src={coverSrc}
                          alt={relation.title}
                          fill
                          sizes="48px"
                          className="object-cover"
                          unoptimized={isProtectedApiImageSrc(coverSrc)}
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium line-clamp-2">{relation.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[relation.relationType?.replace(/_/g, ' ').toLowerCase(), relation.format?.replace('_', ' '), relation.seasonYear]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    {busyId === relation.id ? (
                      <Loader2 className="h-4 w-4 animate-spin self-center shrink-0" />
                    ) : (
                      <Plus className="h-4 w-4 self-center shrink-0 text-muted-foreground" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Search */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Search AniList</p>
            <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <SearchInput
                value={query}
                onChange={(value) => {
                  setResults([]);
                  setLoading(false);
                  setError(null);
                  setQuery(value);
                }}
                historyKey="anilist-remap"
                placeholder="Search AniList"
                wrapperClassName="flex-1"
                className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              />
            </div>

            {loading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="flex gap-3 rounded-lg border border-border/30 p-3">
                  <Skeleton className="h-[72px] w-[48px] rounded-md shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))
            ) : results.length > 0 ? (
              results.map((candidate) => {
                const coverSrc = cover(candidate.coverImage);
                const isLinked = linkedIds.has(candidate.id);

                return (
                  <button
                    key={candidate.id}
                    onClick={() => addEntry(candidate.id)}
                    disabled={busy || isLinked}
                    className="flex w-full gap-3 rounded-lg border border-border/30 bg-muted/10 p-3 text-left active:bg-muted/30 disabled:opacity-60"
                  >
                    <div className="relative h-[72px] w-[48px] shrink-0 overflow-hidden rounded-md bg-muted">
                      {coverSrc && (
                        <Image
                          src={coverSrc}
                          alt={candidate.title}
                          fill
                          sizes="48px"
                          className="object-cover"
                          unoptimized={isProtectedApiImageSrc(coverSrc)}
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium line-clamp-2">{candidate.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[candidate.format?.replace('_', ' '), candidate.seasonYear].filter(Boolean).join(' · ')}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                        {candidate.averageScore != null && (
                          <Badge variant="outline" className="text-[10px]">{candidate.averageScore}%</Badge>
                        )}
                        {candidate.episodes != null && (
                          <Badge variant="outline" className="text-[10px]">{candidate.episodes} eps</Badge>
                        )}
                        <Badge variant="secondary" className="text-[10px]">Match {candidate.matchScore}</Badge>
                      </div>
                    </div>
                    {busyId === candidate.id ? (
                      <Loader2 className="h-4 w-4 animate-spin self-center shrink-0" />
                    ) : isLinked ? (
                      <Star className="h-4 w-4 self-center shrink-0 text-[var(--hpr-amber)] fill-current" />
                    ) : (
                      <Plus className="h-4 w-4 self-center shrink-0 text-muted-foreground" />
                    )}
                  </button>
                );
              })
            ) : (
              <div className="rounded-lg border border-border/30 bg-muted/10 px-3 py-6 text-center text-sm text-muted-foreground">
                No AniList candidates found.
              </div>
            )}
          </div>
        </div>

        <DrawerFooter className="flex-row gap-2">
          {entries.length > 0 && (
            <Button variant="outline" onClick={handleClearAll} disabled={busy} className="flex-1">
              {clearing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Clear all
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)} disabled={busy} className="flex-1">
            Done
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
