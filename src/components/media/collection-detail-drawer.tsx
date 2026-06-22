'use client';

import { useEffect, useState, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Check, Plus, Search, Loader2, Film, Bookmark } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useCan } from '@/components/permission-provider';
import { invalidateCollections } from '@/lib/query-invalidation';
import { ApiError } from '@/lib/query-fetch';
import { handleAuthError } from '@/lib/query-client';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { cn } from '@/lib/utils';
import type { CollectionMovieSummary, CollectionSummary } from '@/types';

interface Props {
  collection: CollectionSummary | null;
  multiInstance?: boolean;
  onClose: () => void;
}

async function mutate(path: string, method: 'POST' | 'PUT', body: unknown): Promise<void> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new ApiError(res.status, err?.error || `Request failed (${res.status})`);
  }
}

export function CollectionDetailDrawer({ collection, multiInstance, onClose }: Props) {
  const open = collection !== null;
  const qc = useQueryClient();
  const canMonitor = useCan('movies.editMonitoring');
  const canAdd = useCan('movies.add');
  const canSearch = useCan('activity.manage');

  // Local copies so the drawer reflects actions instantly while the list refetches.
  const [monitored, setMonitored] = useState(false);
  const [movies, setMovies] = useState<CollectionMovieSummary[]>([]);
  const [monitorPending, setMonitorPending] = useState(false);
  const [searchPending, setSearchPending] = useState(false);
  const [addAllPending, setAddAllPending] = useState(false);
  const [addingTmdb, setAddingTmdb] = useState<Set<number>>(new Set());

  // Reset local state whenever a different collection opens.
  useEffect(() => {
    if (!collection) return;
    setMonitored(collection.monitored);
    setMovies(collection.movies);
    setAddingTmdb(new Set());
  }, [collection]);

  const instanceId = collection?.instanceId;
  const instanceQuery = instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : '';

  const inLibraryCount = useMemo(() => movies.filter((m) => m.inLibrary).length, [movies]);
  const missingMovies = useMemo(() => movies.filter((m) => !m.inLibrary), [movies]);
  const yearRange = useMemo(() => {
    const years = movies.map((m) => m.year).filter((y): y is number => typeof y === 'number' && y > 0);
    if (years.length === 0) return null;
    const min = Math.min(...years);
    const max = Math.max(...years);
    return min === max ? `${min}` : `${min}–${max}`;
  }, [movies]);

  function reportError(error: unknown, fallback: string) {
    handleAuthError(error);
    if (error instanceof ApiError && error.status === 401) return;
    toast.error(error instanceof Error ? error.message : fallback);
  }

  async function toggleMonitor(next: boolean) {
    if (!collection || monitorPending) return;
    setMonitored(next); // optimistic
    setMonitorPending(true);
    try {
      await mutate('/api/radarr/collections', 'PUT', { collectionId: collection.id, monitored: next, instanceId });
      invalidateCollections(qc);
      toast.success(next ? 'Collection monitored' : 'Collection unmonitored');
    } catch (error) {
      setMonitored(!next); // revert
      reportError(error, 'Failed to update monitoring');
    } finally {
      setMonitorPending(false);
    }
  }

  async function addMovie(tmdbId: number) {
    if (!collection) return;
    setAddingTmdb((prev) => new Set(prev).add(tmdbId));
    try {
      await mutate('/api/radarr/collections', 'POST', { collectionId: collection.id, tmdbId, instanceId, search: true });
      setMovies((prev) => prev.map((m) => (m.tmdbId === tmdbId ? { ...m, inLibrary: true } : m)));
      invalidateCollections(qc);
      toast.success('Added to Radarr');
    } catch (error) {
      reportError(error, 'Failed to add movie');
    } finally {
      setAddingTmdb((prev) => {
        const next = new Set(prev);
        next.delete(tmdbId);
        return next;
      });
    }
  }

  async function addAllMissing() {
    if (!collection || addAllPending || missingMovies.length === 0) return;
    setAddAllPending(true);
    const targets = missingMovies.map((m) => m.tmdbId);
    const results = await Promise.allSettled(
      targets.map((tmdbId) =>
        mutate('/api/radarr/collections', 'POST', { collectionId: collection.id, tmdbId, instanceId, search: true })
      )
    );
    const added = targets.filter((_, i) => results[i].status === 'fulfilled');
    const failed = results.length - added.length;
    if (added.length) {
      const addedSet = new Set(added);
      setMovies((prev) => prev.map((m) => (addedSet.has(m.tmdbId) ? { ...m, inLibrary: true } : m)));
      invalidateCollections(qc);
    }
    const firstError = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (firstError) handleAuthError(firstError.reason);
    if (failed === 0) toast.success(`Added ${added.length} ${added.length === 1 ? 'movie' : 'movies'}`);
    else if (added.length) toast.warning(`Added ${added.length}, ${failed} failed`);
    else toast.error('Failed to add movies');
    setAddAllPending(false);
  }

  async function searchMissing() {
    if (!collection || searchPending) return;
    const fileless = movies.filter((m) => m.inLibrary && m.movieId && !m.hasFile).map((m) => m.movieId!);
    const ids = fileless.length
      ? fileless
      : movies.filter((m) => m.inLibrary && m.movieId).map((m) => m.movieId!);
    if (ids.length === 0) {
      toast.info('Nothing in this collection to search');
      return;
    }
    setSearchPending(true);
    try {
      await mutate(`/api/radarr/command${instanceQuery}`, 'POST', { name: 'MoviesSearch', movieIds: ids });
      toast.success(`Searching ${ids.length} ${ids.length === 1 ? 'movie' : 'movies'}`);
    } catch (error) {
      reportError(error, 'Failed to start search');
    } finally {
      setSearchPending(false);
    }
  }

  const headerPoster = toCachedImageSrc(collection?.poster, 'tmdb', { width: 240 });
  const hasSearchable = movies.some((m) => m.inLibrary && m.movieId);

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }} direction="bottom">
      <DrawerContent>
        {collection && (
          <>
            <DrawerHeader className="text-left pb-2">
              <div className="flex gap-3">
                <div className="relative w-16 h-24 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {headerPoster ? (
                    <Image
                      src={headerPoster}
                      alt={collection.title}
                      fill
                      sizes="64px"
                      className="object-cover"
                      unoptimized={isProtectedApiImageSrc(headerPoster)}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                      <Film className="h-5 w-5" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <DrawerTitle className="text-base leading-tight line-clamp-2">{collection.title}</DrawerTitle>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {yearRange && <span>{yearRange} · </span>}
                    {collection.movieCount} films · {inLibraryCount} in library
                    {missingMovies.length > 0 && (
                      <span className="text-[var(--hpr-amber)] font-medium"> · {missingMovies.length} missing</span>
                    )}
                    {multiInstance && collection.instanceLabel && (
                      <span className="text-[var(--hpr-amber)]"> · {collection.instanceLabel}</span>
                    )}
                  </p>
                  {collection.genres.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {collection.genres.slice(0, 4).map((g) => (
                        <Badge key={g} variant="secondary" className="text-[9px] px-1.5 py-0">
                          {g}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </DrawerHeader>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6">
              {/* Action bar */}
              <div className="flex flex-wrap items-center gap-2 pb-3">
                {canMonitor && (
                  <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-1.5 text-sm">
                    <Bookmark className={cn('h-4 w-4', monitored ? 'fill-[var(--hpr-amber)] text-[var(--hpr-amber)]' : 'text-muted-foreground')} />
                    <span className="select-none">Monitored</span>
                    <Switch checked={monitored} disabled={monitorPending} onCheckedChange={toggleMonitor} aria-label="Monitor collection" />
                  </label>
                )}
                {canAdd && missingMovies.length > 0 && (
                  <Button size="sm" variant="default" disabled={addAllPending} onClick={addAllMissing}>
                    {addAllPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add {missingMovies.length} missing
                  </Button>
                )}
                {canSearch && hasSearchable && (
                  <Button size="sm" variant="outline" disabled={searchPending} onClick={searchMissing}>
                    {searchPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Search
                  </Button>
                )}
              </div>

              {collection.overview && (
                <p className="text-[13px] leading-relaxed text-muted-foreground pb-4">{collection.overview}</p>
              )}

              {/* Movie rail */}
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground pb-2">Movies</div>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide snap-x">
                {movies.map((m) => (
                  <CollectionMoviePoster
                    key={m.tmdbId}
                    movie={m}
                    instanceId={instanceId}
                    canAdd={canAdd}
                    adding={addingTmdb.has(m.tmdbId)}
                    onAdd={() => addMovie(m.tmdbId)}
                    onNavigate={onClose}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function CollectionMoviePoster({
  movie,
  instanceId,
  canAdd,
  adding,
  onAdd,
  onNavigate,
}: {
  movie: CollectionMovieSummary;
  instanceId?: string;
  canAdd: boolean;
  adding: boolean;
  onAdd: () => void;
  onNavigate: () => void;
}) {
  const poster = toCachedImageSrc(movie.poster, 'tmdb', { width: 200 });
  const linkable = movie.inLibrary && movie.movieId != null;
  const href = linkable
    ? `/movies/${movie.movieId}${instanceId ? `?instance=${encodeURIComponent(instanceId)}` : ''}`
    : null;

  const frame = (
    <div
      className={cn(
        'relative aspect-[2/3] rounded-lg overflow-hidden bg-muted border border-border/40',
        !movie.inLibrary && 'opacity-90'
      )}
    >
      {poster ? (
        <Image
          src={poster}
          alt={movie.title}
          fill
          sizes="96px"
          className="object-cover"
          unoptimized={isProtectedApiImageSrc(poster)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Film className="h-6 w-6" />
        </div>
      )}

      {/* In-library status */}
      {movie.inLibrary ? (
        <div className="absolute top-1 right-1">
          <span
            className={cn(
              'inline-flex h-4 w-4 items-center justify-center rounded-full shadow',
              movie.hasFile ? 'bg-[var(--hpr-green)]' : 'bg-[var(--hpr-amber)]'
            )}
          >
            {movie.hasFile ? (
              <Check className="h-2.5 w-2.5 text-[var(--hpr-ink)]" />
            ) : (
              <Bookmark className="h-2.5 w-2.5 text-[var(--hpr-ink)]" />
            )}
          </span>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-background/45">
          {canAdd ? (
            <button
              type="button"
              onClick={onAdd}
              disabled={adding}
              aria-label={`Add ${movie.title} to Radarr`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--hpr-amber)] text-[var(--hpr-ink)] shadow transition-transform active:scale-95 disabled:opacity-70"
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </button>
          ) : (
            <span className="rounded-full bg-background/70 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              Missing
            </span>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="w-[96px] shrink-0 snap-start">
      {href ? (
        <Link href={href} onClick={onNavigate} className="block">
          {frame}
        </Link>
      ) : (
        frame
      )}
      <p className="mt-1 text-[11px] font-medium leading-tight line-clamp-2">{movie.title}</p>
      {movie.year ? <p className="text-[10px] text-muted-foreground">{movie.year}</p> : null}
    </div>
  );
}
