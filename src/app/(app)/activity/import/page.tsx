'use client';

import { Suspense, useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Loader2, RefreshCw, Check, ChevronRight, Search,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ManualImportItem, SonarrEpisode } from '@/types';

// ── View modes ──────────────────────────────────────────────────────────────

type View = 'files' | 'episodes';

/**
 * Top-level page component that renders ManualImportContent inside a Suspense boundary with a skeleton fallback.
 *
 * @returns A JSX element containing a Suspense boundary that displays skeleton placeholders while ManualImportContent resolves.
 */

export default function ManualImportPage() {
  return (
    <Suspense fallback={
      <div className="px-4 py-4 space-y-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
    }>
      <ManualImportContent />
    </Suspense>
  );
}

/**
 * Render the manual import interface for inspecting detected files, assigning Sonarr episodes, and submitting imports.
 *
 * Reads relevant URL search parameters (downloadId, source, seriesId, movieId, title), fetches import and episode data,
 * provides an episode picker with search and refresh capabilities (Sonarr), and submits the selected import payload.
 *
 * @returns The rendered manual import UI component for selecting files/episodes and submitting imports.
 */

function ManualImportContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const downloadId = searchParams.get('downloadId') || '';
  const source = (searchParams.get('source') || 'sonarr') as 'sonarr' | 'radarr';
  const seriesId = searchParams.get('seriesId');
  const movieId = searchParams.get('movieId');
  const itemTitle = searchParams.get('title') || 'Manual Import';

  const isSonarr = source === 'sonarr';

  // State
  const [files, setFiles] = useState<ManualImportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Episode data (Sonarr only)
  const [allEpisodes, setAllEpisodes] = useState<SonarrEpisode[]>([]);
  const [refreshingEpisodes, setRefreshingEpisodes] = useState(false);

  // Per-file episode overrides: fileIndex → episodes
  const [fileOverrides, setFileOverrides] = useState<Map<number, SonarrEpisode[]>>(new Map());

  // Episode picker state
  const [view, setView] = useState<View>('files');
  const [pickerFileIndex, setPickerFileIndex] = useState<number>(0);
  const [episodeSearch, setEpisodeSearch] = useState('');

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!downloadId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ downloadId, source });
      const fetches: Promise<unknown>[] = [
        fetch(`/api/activity/manualimport?${params}`).then((r) => r.ok ? r.json() : []),
      ];

      if (isSonarr && seriesId) {
        fetches.push(
          fetch(`/api/sonarr/${seriesId}/episodes`).then((r) => r.ok ? r.json() : [])
        );
      }

      const [filesResult, episodesResult] = await Promise.all(fetches);
      setFiles(filesResult as ManualImportItem[]);
      if (episodesResult) setAllEpisodes(episodesResult as SonarrEpisode[]);
    } catch {
      toast.error('Failed to load import data');
    } finally {
      setLoading(false);
    }
  }, [downloadId, source, isSonarr, seriesId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Episode helpers ───────────────────────────────────────────────────────

  const episodesBySeason = useMemo(() => {
    const grouped = new Map<number, SonarrEpisode[]>();
    for (const ep of allEpisodes) {
      const list = grouped.get(ep.seasonNumber) || [];
      list.push(ep);
      grouped.set(ep.seasonNumber, list);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a - b);
  }, [allEpisodes]);

  const filteredSeasons = useMemo(() => {
    if (!episodeSearch) return episodesBySeason;
    const q = episodeSearch.toLowerCase();
    return episodesBySeason
      .map(([season, episodes]) => {
        const filtered = episodes.filter((ep) =>
          String(ep.episodeNumber).includes(q) ||
          (ep.title || 'TBA').toLowerCase().includes(q) ||
          `s${String(season).padStart(2, '0')}e${String(ep.episodeNumber).padStart(2, '0')}`.includes(q)
        );
        return [season, filtered] as [number, SonarrEpisode[]];
      })
      .filter(([, episodes]) => episodes.length > 0);
  }, [episodesBySeason, episodeSearch]);

  /**
   * Refreshes Sonarr for the current series and updates the local episode list.
   *
   * If no `seriesId` is available, the function returns without performing any action.
   * While running, it marks the UI as refreshing, sends a Sonarr RefreshSeries command,
   * refetches the series' episodes, updates local episode state on success, and displays
   * a success or error toast. The refreshing state is cleared when the operation completes.
   */
  async function handleRefreshEpisodes() {
    if (!seriesId) return;
    setRefreshingEpisodes(true);
    try {
      await fetch('/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'RefreshSeries', seriesId: Number(seriesId) }),
      });
      await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch(`/api/sonarr/${seriesId}/episodes`);
      if (res.ok) {
        const episodes = await res.json();
        setAllEpisodes(episodes);
        toast.success('Episodes refreshed');
      }
    } catch {
      toast.error('Failed to refresh episodes');
    } finally {
      setRefreshingEpisodes(false);
    }
  }

  /**
   * Open the episode picker for a specific file.
   *
   * Resets the episode search, sets the file index that the picker will operate on, and switches the UI to the episodes view.
   *
   * @param fileIndex - Index of the file whose episodes should be selected
   */
  function openEpisodePicker(fileIndex: number) {
    setPickerFileIndex(fileIndex);
    setEpisodeSearch('');
    setView('episodes');
  }

  /**
   * Assigns the given Sonarr episode to the file currently being edited in the episode picker and switches back to the files view.
   *
   * @param ep - The Sonarr episode to assign to the currently selected file
   */
  function selectEpisode(ep: SonarrEpisode) {
    setFileOverrides((prev) => {
      const next = new Map(prev);
      next.set(pickerFileIndex, [ep]);
      return next;
    });
    setView('files');
  }

  /**
   * Submits the current manual-import selection to the server.
   *
   * Builds a payload from the detected files (respecting any per-file episode overrides), posts it to the manual-import API, and on success shows a success toast and navigates back; on failure shows an error toast. Sets the submitting state while the request is in progress.
   */

  async function submitImport() {
    setSubmitting(true);
    try {
      const payload = files.map((f, i) => {
        const override = fileOverrides.get(i);
        const episodes = override && override.length > 0 ? override : (f.episodes || []);

        if (isSonarr) {
          return {
            path: f.path,
            seriesId: seriesId ? Number(seriesId) : undefined,
            episodeIds: episodes.map((ep) => ep.id),
            seasonNumber: episodes.length > 0 ? episodes[0].seasonNumber : f.seasonNumber,
            quality: f.quality,
            languages: f.languages,
            downloadId,
            importMode: 'move' as const,
          };
        }
        return {
          path: f.path,
          movieId: movieId ? Number(movieId) : undefined,
          quality: f.quality,
          languages: f.languages,
          downloadId,
          importMode: 'move' as const,
        };
      });

      const res = await fetch('/api/activity/manualimport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, files: payload }),
      });

      if (res.ok) {
        toast.success('Import submitted');
        router.back();
      } else {
        toast.error('Import failed');
      }
    } catch {
      toast.error('Import failed');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Episode picker view ───────────────────────────────────────────────────

  if (view === 'episodes') {
    const currentFile = files[pickerFileIndex];
    const currentOverride = fileOverrides.get(pickerFileIndex);
    const currentEpisodes = currentOverride || currentFile?.episodes || [];
    const selectedEpId = currentEpisodes.length > 0 ? currentEpisodes[0].id : null;

    return (
      <div className="flex flex-col h-[100dvh] bg-background">
        {/* Header */}
        <PageHeader
          title="Select Episode"
          subtitle={currentFile?.name || currentFile?.relativePath || 'File'}
          onBack={() => { setView('files'); setEpisodeSearch(''); }}
          rightContent={
            isSonarr && seriesId ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleRefreshEpisodes}
                disabled={refreshingEpisodes}
              >
                {refreshingEpisodes ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            ) : undefined
          }
        />

        {/* Search bar */}
        <div className="px-4 py-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search episodes..."
              value={episodeSearch}
              onChange={(e) => setEpisodeSearch(e.target.value)}
              className="w-full text-sm bg-muted/40 rounded-lg pl-9 pr-3 py-2.5 outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary/40 transition-shadow"
              autoFocus
            />
          </div>
        </div>

        {/* Episode list */}
        <div className="flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          {filteredSeasons.length === 0 ? (
            <p className="text-center py-12 text-sm text-muted-foreground">No episodes match</p>
          ) : (
            filteredSeasons.map(([season, episodes]) => (
              <div key={season}>
                {/* Season header */}
                <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-4 py-2 border-b border-border/50">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {season === 0 ? 'Specials' : `Season ${season}`}
                  </span>
                </div>

                {/* Episodes */}
                {episodes.map((ep) => {
                  const isSelected = ep.id === selectedEpId;
                  const isTBA = !ep.title || ep.title === 'TBA';
                  return (
                    <button
                      key={ep.id}
                      onClick={() => selectEpisode(ep)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:bg-muted/60 ${
                        isSelected ? 'bg-primary/8' : 'hover:bg-muted/40'
                      }`}
                    >
                      {/* Episode number */}
                      <span className="text-xs text-muted-foreground tabular-nums w-8 shrink-0 font-medium">
                        E{String(ep.episodeNumber).padStart(2, '0')}
                      </span>

                      {/* Title + airdate */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm truncate ${isTBA ? 'text-muted-foreground italic' : ''}`}>
                          {ep.title || 'TBA'}
                        </p>
                        {ep.airDate && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">{ep.airDate}</p>
                        )}
                      </div>

                      {/* Selection indicator */}
                      {isSelected && (
                        <Check className="h-4 w-4 text-primary shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // ── Files view (default) ──────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      <PageHeader
        title="Manual Import"
        subtitle={itemTitle}
        onBack={() => router.back()}
      />

      <div className="flex-1 overflow-y-auto overscroll-contain pb-28 md:pb-0">
        {loading ? (
          <div className="px-4 py-4 space-y-3">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-sm">No files detected</p>
          </div>
        ) : (
          <div className="px-4 py-3 space-y-3">
            {/* Refresh episodes button (Sonarr only) */}
            {isSonarr && seriesId && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleRefreshEpisodes}
                disabled={refreshingEpisodes}
              >
                {refreshingEpisodes ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                )}
                Refresh Episodes
              </Button>
            )}

            {/* File cards */}
            {files.map((f, i) => {
              const override = fileOverrides.get(i);
              const currentEpisodes = override || f.episodes || [];
              const hasEpisode = currentEpisodes.length > 0;

              return (
                <div key={i} className="rounded-xl bg-muted/30 border border-border/40 overflow-hidden">
                  {/* File info */}
                  <div className="p-3.5 space-y-2">
                    {/* Filename */}
                    <p className="text-sm font-medium leading-snug break-words">
                      {f.name || f.relativePath}
                    </p>

                    {/* Metadata badges */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {f.quality?.quality?.name && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {f.quality.quality.name}
                        </Badge>
                      )}
                      {f.series && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {f.series.title}
                        </Badge>
                      )}
                      {f.movie && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {f.movie.title}
                        </Badge>
                      )}
                      {f.languages && f.languages.length > 0 && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {f.languages.map((l) => l.name).join(', ')}
                        </Badge>
                      )}
                    </div>

                    {/* Rejections */}
                    {f.rejections?.length > 0 && (
                      <div className="text-xs text-destructive space-y-0.5">
                        {f.rejections.map((r, ri) => <p key={ri}>{r.reason}</p>)}
                      </div>
                    )}
                  </div>

                  {/* Episode assignment row (Sonarr only) */}
                  {isSonarr && (
                    <button
                      onClick={() => openEpisodePicker(i)}
                      className="w-full flex items-center gap-2 px-3.5 py-2.5 bg-muted/20 border-t border-border/30 transition-colors active:bg-muted/40"
                    >
                      <div className="flex-1 min-w-0 text-left">
                        {hasEpisode ? (
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-[10px] shrink-0">
                              S{String(currentEpisodes[0].seasonNumber).padStart(2, '0')}E
                              {currentEpisodes.map((e) => String(e.episodeNumber).padStart(2, '0')).join(', E')}
                            </Badge>
                            <span className="text-xs text-muted-foreground truncate">
                              {currentEpisodes[0].title || 'TBA'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-destructive font-medium">No episode assigned</span>
                        )}
                      </div>
                      <span className="text-xs text-primary font-medium shrink-0">Change</span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      {!loading && files.length > 0 && (
        <div
          className="fixed md:sticky left-0 right-0 bottom-[calc(3rem+env(safe-area-inset-bottom))] md:bottom-0 z-40 md:z-30 border-t border-border bg-background/95 backdrop-blur-sm px-4 py-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <Button
            onClick={submitImport}
            disabled={submitting}
            className="w-full h-11"
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Import {files.length === 1 ? 'File' : `${files.length} Files`}
          </Button>
        </div>
      )}
    </div>
  );
}
