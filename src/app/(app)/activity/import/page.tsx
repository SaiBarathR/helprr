'use client';

import { Suspense, useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/page-spinner';
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
    <Suspense fallback={<PageSpinner />}>
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
        <PageHeader
          title="Select Episode"
          subtitle={currentFile?.name || currentFile?.relativePath || 'File'}
          onBack={() => { setView('files'); setEpisodeSearch(''); }}
          rightContent={
            isSonarr && seriesId ? (
              <button
                className="press-feedback h-9 w-9 inline-flex items-center justify-center hover:text-[color:var(--amber)] transition-colors"
                onClick={handleRefreshEpisodes}
                disabled={refreshingEpisodes}
                aria-label="Refresh episodes"
              >
                {refreshingEpisodes ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[color:var(--amber)]" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </button>
            ) : undefined
          }
        />

        <div className="py-2.5 border-b border-[color:var(--hairline)]">
          <div className="relative group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70 group-focus-within:text-[color:var(--amber)] transition-colors pointer-events-none" />
            <input
              type="text"
              placeholder="Search episodes…"
              value={episodeSearch}
              onChange={(e) => setEpisodeSearch(e.target.value)}
              className="w-full text-[14px] bg-card/40 border border-[color:var(--hairline)] pl-10 pr-3 py-2.5 outline-none placeholder:text-muted-foreground/70 focus:border-[color:var(--amber)]/50 focus:ring-2 focus:ring-[color:var(--amber)]/20 transition-all"
              style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          {filteredSeasons.length === 0 ? (
            <div className="px-4 py-16 text-center">
              <p className="tracked-caps text-[10px] text-muted-foreground">No matches</p>
              <p className="font-display text-[16px] mt-1">Empty reel.</p>
            </div>
          ) : (
            filteredSeasons.map(([season, episodes]) => (
              <div key={season}>
                <div className="sticky top-0 z-10 bg-background/85 backdrop-blur-xl py-2 border-b border-[color:var(--hairline)] flex items-center gap-2">
                  <span
                    className="font-mono tabular tracked-mid text-[10px] text-[color:var(--amber)]"
                    style={{ letterSpacing: '0.2em' }}
                  >
                    S{String(season).padStart(2, '0')}
                  </span>
                  <span className="font-display text-[13px]" style={{ letterSpacing: '-0.01em' }}>
                    {season === 0 ? 'Specials' : `Season ${season}`}
                  </span>
                  <span className="hairline flex-1" aria-hidden />
                </div>

                {episodes.map((ep) => {
                  const isSelected = ep.id === selectedEpId;
                  const isTBA = !ep.title || ep.title === 'TBA';
                  return (
                    <button
                      key={ep.id}
                      onClick={() => selectEpisode(ep)}
                      className={`group w-full flex items-center gap-3 px-1 py-3 text-left border-b border-[color:var(--hairline)] transition-colors ${
                        isSelected ? 'bg-[color:var(--amber-soft)]/40' : 'hover:bg-[color:var(--amber-soft)]/30'
                      }`}
                    >
                      <span className="font-mono tabular tracked-mid text-[10px] text-[color:var(--amber)]/85 w-10 shrink-0 text-center" style={{ letterSpacing: '0.18em' }}>
                        E{String(ep.episodeNumber).padStart(2, '0')}
                      </span>

                      <div className="flex-1 min-w-0">
                        <p className={`font-display text-[13.5px] truncate ${isTBA ? 'text-muted-foreground italic' : ''}`} style={{ letterSpacing: '-0.012em' }}>
                          {ep.title || 'TBA'}
                        </p>
                        {ep.airDate && (
                          <p className="font-mono tabular text-[10px] text-muted-foreground/85 mt-0.5">{ep.airDate}</p>
                        )}
                      </div>

                      {isSelected && (
                        <Check className="h-4 w-4 text-[color:var(--amber)] shrink-0" strokeWidth={3} />
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
    <div className="flex flex-col h-[100dvh] bg-background animate-content-in">
      <PageHeader
        title="Manual Import"
        subtitle={itemTitle}
        onBack={() => router.back()}
      />

      <div className="flex-1 overflow-y-auto overscroll-contain pb-28 md:pb-0">
        {loading ? (
          <PageSpinner />
        ) : files.length === 0 ? (
          <div
            className="mt-6 border border-[color:var(--hairline)] bg-card/40 p-10 text-center space-y-3"
            style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
          >
            <p className="tracked-caps text-[10px] text-muted-foreground">No files detected</p>
            <p className="font-display text-[16px]">Reel not yet pressed.</p>
          </div>
        ) : (
          <div className="py-3 space-y-3">
            {isSonarr && seriesId && (
              <Button
                variant="outline"
                size="sm"
                className="w-full h-9"
                onClick={handleRefreshEpisodes}
                disabled={refreshingEpisodes}
              >
                {refreshingEpisodes ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                <span className="tracked-caps text-[9.5px]">Refresh Episodes</span>
              </Button>
            )}

            <div className="border border-[color:var(--hairline)] bg-card/40 overflow-hidden" style={{ borderRadius: 'calc(var(--radius) - 1px)' }}>
              {files.map((f, i) => {
                const override = fileOverrides.get(i);
                const currentEpisodes = override || f.episodes || [];
                const hasEpisode = currentEpisodes.length > 0;

                return (
                  <div key={i} className="border-b border-[color:var(--hairline)] last:border-b-0">
                    <div className="px-3.5 py-3 space-y-2">
                      <p className="font-mono tabular text-[12px] leading-snug break-words text-foreground/95">
                        {f.name || f.relativePath}
                      </p>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {f.quality?.quality?.name && (
                          <span
                            className="tracked-caps text-[8.5px] px-1.5 py-0.5 bg-[color:var(--amber-soft)] text-[color:var(--amber)]"
                            style={{ borderRadius: '3px', letterSpacing: '0.22em' }}
                          >
                            {f.quality.quality.name}
                          </span>
                        )}
                        {f.series && (
                          <span
                            className="tracked-caps text-[8.5px] px-1.5 py-0.5 border border-[color:var(--hairline)] bg-card/50 text-muted-foreground"
                            style={{ borderRadius: '3px', letterSpacing: '0.22em' }}
                          >
                            {f.series.title}
                          </span>
                        )}
                        {f.movie && (
                          <span
                            className="tracked-caps text-[8.5px] px-1.5 py-0.5 border border-[color:var(--hairline)] bg-card/50 text-muted-foreground"
                            style={{ borderRadius: '3px', letterSpacing: '0.22em' }}
                          >
                            {f.movie.title}
                          </span>
                        )}
                        {f.languages && f.languages.length > 0 && (
                          <span
                            className="tracked-caps text-[8.5px] px-1.5 py-0.5 border border-[color:var(--hairline)] bg-card/50 text-muted-foreground"
                            style={{ borderRadius: '3px', letterSpacing: '0.22em' }}
                          >
                            {f.languages.map((l) => l.name).join(' · ')}
                          </span>
                        )}
                      </div>

                      {f.rejections?.length > 0 && (
                        <div className="text-[11.5px] text-destructive space-y-0.5">
                          {f.rejections.map((r, ri) => <p key={ri}>· {r.reason}</p>)}
                        </div>
                      )}
                    </div>

                    {isSonarr && (
                      <button
                        onClick={() => openEpisodePicker(i)}
                        className="w-full flex items-center gap-2 px-3.5 py-2.5 bg-[color:var(--amber-soft)]/20 border-t border-[color:var(--hairline)] transition-colors hover:bg-[color:var(--amber-soft)]/40"
                      >
                        <div className="flex-1 min-w-0 text-left">
                          {hasEpisode ? (
                            <div className="flex items-center gap-2">
                              <span
                                className="tracked-caps text-[8.5px] px-1.5 py-0.5 bg-[color:var(--amber-soft)] text-[color:var(--amber)] shrink-0"
                                style={{ borderRadius: '3px', letterSpacing: '0.22em' }}
                              >
                                S{String(currentEpisodes[0].seasonNumber).padStart(2, '0')}E
                                {currentEpisodes.map((e) => String(e.episodeNumber).padStart(2, '0')).join(', E')}
                              </span>
                              <span className="font-display text-[12.5px] text-muted-foreground truncate" style={{ letterSpacing: '-0.01em' }}>
                                {currentEpisodes[0].title || 'TBA'}
                              </span>
                            </div>
                          ) : (
                            <span className="tracked-caps text-[9.5px] text-destructive">No episode assigned</span>
                          )}
                        </div>
                        <span className="tracked-caps text-[9.5px] text-[color:var(--amber)] shrink-0">Change</span>
                        <ChevronRight className="h-3.5 w-3.5 text-[color:var(--amber)] shrink-0" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {!loading && files.length > 0 && (
        <div
          className="fixed md:sticky left-0 right-0 bottom-[calc(3rem+env(safe-area-inset-bottom))] md:bottom-0 z-40 md:z-30 border-t border-[color:var(--hairline)] bg-background/85 backdrop-blur-xl px-4 py-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <Button
            onClick={submitImport}
            disabled={submitting}
            className="w-full h-11 cta-sheen projector-glow"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            <span className="tracked-caps text-[10px]">
              Import {files.length === 1 ? 'File' : `${files.length} Files`}
            </span>
          </Button>
        </div>
      )}
    </div>
  );
}
