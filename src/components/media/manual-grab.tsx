'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, Loader2 } from 'lucide-react';

import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer';
import { EpisodePicker, LanguagePicker, MediaPicker, QualityPicker, SeasonPicker, type MediaOption } from '@/components/media/arr-pickers';
import { useCan } from '@/components/permission-provider';
import { useLanguages, useQualityDefinitions } from '@/lib/hooks/use-reference-data';
import { ensureArray, jsonFetcher, withInstanceQuery } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import type { ArrLanguage, ArrQualityModel, DownloadClient, Release, SonarrEpisode } from '@/types';

/*
 * Sonarr's and Radarr's own interactive search grab a release they couldn't
 * match only after asking: "grab anyway" with the item that was searched for,
 * or a Manual grab where the user chooses the series, season and episodes (or
 * the movie), quality, languages and download client. Helprr does the same.
 */

/** The item the page searched for, from its route. */
export type SearchedItem = { seriesId?: number; seasonNumber?: number; episodeId?: number; movieId?: number };

type Service = 'sonarr' | 'radarr';

// ── Grab anyway ───────────────────────────────────────────────────────────────

export function GrabAnywayDialog({ service, release, onCancel, onChooseManually, onGrabAnyway }: {
  service: Service;
  release: Release | null;
  onCancel: () => void;
  onChooseManually: () => void;
  onGrabAnyway: () => void;
}) {
  const what = service === 'sonarr' ? "Sonarr couldn't tell which series and episode" : "Radarr couldn't tell which movie";
  return (
    <AlertDialog open={release !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Grab release?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {what} this release is for, so it may not import it automatically. Grab “{release?.title}” anyway?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="outline" onClick={onChooseManually}>Choose manually</Button>
          <Button onClick={onGrabAnyway}>Grab anyway</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Manual grab ───────────────────────────────────────────────────────────────

export type GrabOutcome = { ok: true } | { ok: false; error: string; code?: string };

interface Draft {
  seriesId?: number;
  seasonNumber?: number;
  /** Chosen episodes; null until the search's own episode numbers resolve (D1, season search). */
  episodeIds: number[] | null;
  /** A season search's release numbers, resolved once the season's episodes load. */
  pendingEpisodes?: number[] | 'all';
  movieId?: number;
  quality: ArrQualityModel;
  languages: ArrLanguage[];
  downloadClientId: number | null;
  /** Series/episode (or movie) came from the page searched on, not from the *arr's match. */
  fromSearch: boolean;
}

// The grab route needs a full revision; Sonarr's release always sends one, but keep it safe.
function fullQuality(q: ArrQualityModel): ArrQualityModel {
  return { quality: q.quality, revision: { version: q.revision?.version ?? 1, real: q.revision?.real ?? 0, isRepack: q.revision?.isRepack ?? false } };
}

/**
 * What the sheet starts with: the *arr's own match when it made one, else the
 * item the page searched for (so a manual grab is usually one tap), else blank.
 */
export function initialDraft(service: Service, release: Release, searched: SearchedItem): Draft {
  const base = { quality: fullQuality(release.quality), languages: release.languages ?? [], downloadClientId: null };
  if (service === 'radarr') {
    if (release.mappedMovieId) return { ...base, movieId: release.mappedMovieId, episodeIds: [], fromSearch: false };
    return { ...base, movieId: searched.movieId, episodeIds: [], fromSearch: searched.movieId !== undefined };
  }
  if (release.mappedSeriesId) {
    const eps = release.mappedEpisodeInfo ?? [];
    return {
      ...base, seriesId: release.mappedSeriesId, seasonNumber: release.mappedSeasonNumber ?? eps[0]?.seasonNumber,
      episodeIds: eps.map((e) => e.id), fromSearch: false,
    };
  }
  if (searched.seriesId !== undefined) {
    const draft = { ...base, seriesId: searched.seriesId, seasonNumber: searched.seasonNumber, fromSearch: true };
    if (searched.episodeId !== undefined) return { ...draft, episodeIds: [searched.episodeId] };
    // A season search: the episodes the release's own title names in that season, or all of a season pack.
    const sameSeason = release.seasonNumber === searched.seasonNumber;
    return {
      ...draft, episodeIds: null,
      pendingEpisodes: release.fullSeason && sameSeason ? 'all' : sameSeason ? release.episodeNumbers ?? [] : [],
    };
  }
  return { ...base, episodeIds: [], fromSearch: false };
}

function seasonLabel(season: number | undefined) {
  if (season === undefined) return undefined;
  return season === 0 ? 'Specials' : `Season ${season}`;
}

/** One tappable row of the sheet, as in Manage files' property menu. */
function SheetRow({ label, value, placeholder, disabled, onPress }: {
  label: string; value?: React.ReactNode; placeholder: string; disabled?: boolean; onPress?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || !onPress}
      onClick={onPress}
      className="flex min-h-[52px] w-full items-center gap-3 border-b border-border/40 px-1 py-3 text-left text-sm active:bg-muted/40 disabled:active:bg-transparent"
    >
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 flex-1 break-words', !value && 'text-muted-foreground', disabled && 'opacity-60')}>
        {value || placeholder}
      </span>
      {onPress && !disabled && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </button>
  );
}

/**
 * The Manual grab sheet for one release. Series and episode lists open full
 * screen in place of the search page (`onFullScreenChange` hides the page);
 * quality, languages, season and download client open as dialogs over it.
 */
export function ManualGrabSheet({
  service, instanceId, open, release, searched, downloadClients, onClose, onGrab, onFullScreenChange, onSearchAgain,
}: {
  service: Service;
  instanceId?: string;
  open: boolean;
  release: Release;
  searched: SearchedItem;
  /** Enabled download clients; only those for the release's protocol are offered. */
  downloadClients: DownloadClient[];
  onClose: () => void;
  onGrab: (release: Release, body: Record<string, unknown>) => Promise<GrabOutcome>;
  onFullScreenChange: (fullScreen: boolean) => void;
  onSearchAgain: () => void;
}) {
  const isSonarr = service === 'sonarr';
  const canBrowse = useCan(isSonarr ? 'series.view' : 'movies.view');
  const [draft, setDraft] = React.useState<Draft>(() => initialDraft(service, release, searched));
  const [screen, setScreen] = React.useState<'sheet' | 'media' | 'episodes'>('sheet');
  const [dialog, setDialog] = React.useState<null | 'season' | 'quality' | 'language' | 'client'>(null);
  const [error, setError] = React.useState<{ text: string; code?: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const go = (next: 'sheet' | 'media' | 'episodes') => {
    setScreen(next);
    onFullScreenChange(next !== 'sheet');
  };

  // The library list names the chosen series or movie and is what the user picks from.
  const mediaQuery = useQuery({
    queryKey: queryKeys.library(service, { instanceId }),
    queryFn: jsonFetcher<MediaOption[]>(withInstanceQuery(isSonarr ? '/api/sonarr' : '/api/radarr', instanceId)),
    enabled: open && canBrowse,
    staleTime: 60_000,
    select: ensureArray,
  });
  const episodesQuery = useQuery({
    queryKey: queryKeys.episodes(Number(draft.seriesId), instanceId),
    queryFn: jsonFetcher<SonarrEpisode[]>(withInstanceQuery(`/api/sonarr/${draft.seriesId}/episodes`, instanceId)),
    enabled: open && isSonarr && draft.seriesId !== undefined,
    select: ensureArray,
  });
  const qualityDefs = useQualityDefinitions(service, instanceId, open);
  const languages = useLanguages(service, instanceId, open);

  const allEpisodes = React.useMemo(() => episodesQuery.data ?? [], [episodesQuery.data]);
  const seasonEpisodes = React.useMemo(
    () => allEpisodes.filter((e) => e.seasonNumber === draft.seasonNumber),
    [allEpisodes, draft.seasonNumber],
  );
  // Derived, not stored: a season search's numbers become ids once the season has loaded.
  const episodeIds = React.useMemo(() => {
    if (draft.episodeIds) return draft.episodeIds;
    if (draft.pendingEpisodes === 'all') return seasonEpisodes.map((e) => e.id);
    const wanted = new Set(draft.pendingEpisodes ?? []);
    return seasonEpisodes.filter((e) => wanted.has(e.episodeNumber)).map((e) => e.id);
  }, [draft.episodeIds, draft.pendingEpisodes, seasonEpisodes]);

  const chosenId = isSonarr ? draft.seriesId : draft.movieId;
  const chosen = mediaQuery.data?.find((m) => m.id === chosenId);
  const isAnime = (chosen as { seriesType?: string } | undefined)?.seriesType === 'anime';
  // The title alone, as in Sonarr's sheet (Sonarr titles often carry the year already).
  // Without library access: the *arr's own match by the release's title, or the
  // searched item by what it is (an unmatched release's title names something else).
  const chosenTitle = chosen
    ? chosen.title
    : chosenId === undefined
      ? undefined
      : canBrowse && mediaQuery.isLoading
        ? 'Loading…'
        : draft.fromSearch
          ? (isSonarr ? 'The series you searched for' : 'The movie you searched for')
          : (isSonarr ? release.seriesTitle : release.movieTitles?.[0]) || `#${chosenId}`;

  const episodeLabels = episodeIds.map((id) => {
    const ep = allEpisodes.find((e) => e.id === id) ?? release.mappedEpisodeInfo?.find((e) => e.id === id);
    if (!ep) return { id, text: `Episode ${id}` };
    const abs = isAnime && ep.absoluteEpisodeNumber != null ? ` (${ep.absoluteEpisodeNumber})` : '';
    return { id, text: `${ep.episodeNumber}${abs} – ${ep.title || 'TBA'}` };
  });

  const protocolClients = downloadClients.filter((c) => c.protocol === release.protocol);
  const clientName = protocolClients.find((c) => c.id === draft.downloadClientId)?.name ?? 'Default';
  const qualityLabel = `${draft.quality.quality.name}${(draft.quality.revision?.version ?? 1) > 1 ? ' · Proper' : ''}${(draft.quality.revision?.real ?? 0) > 0 ? ' · Real' : ''}`;

  const edit = (patch: Partial<Draft>) => { setDraft((d) => ({ ...d, ...patch })); setError(null); };

  async function grab() {
    const missing = isSonarr
      ? (draft.seriesId === undefined ? 'Choose a series' : episodeIds.length === 0 ? 'Choose at least one episode' : null)
      : (draft.movieId === undefined ? 'Choose a movie' : null);
    const missingChoice = missing ?? (draft.languages.length === 0 ? 'Choose at least one language' : null);
    if (missingChoice) { setError({ text: missingChoice }); return; }
    const body: Record<string, unknown> = {
      shouldOverride: true,
      ...(isSonarr ? { seriesId: draft.seriesId, episodeIds } : { movieId: draft.movieId }),
      quality: draft.quality,
      languages: draft.languages,
      ...(draft.downloadClientId !== null ? { downloadClientId: draft.downloadClientId } : {}),
    };
    setBusy(true);
    setError(null);
    const outcome = await onGrab(release, body);
    setBusy(false);
    if (outcome.ok) onClose();
    else setError({ text: outcome.error, code: outcome.code });
  }

  if (screen === 'media') {
    return (
      <MediaPicker
        kind={isSonarr ? 'series' : 'movie'}
        subtitle={release.title}
        options={mediaQuery.data ?? []}
        loading={mediaQuery.isLoading}
        error={mediaQuery.isError}
        selectedId={chosenId}
        historyKey="manual-grab-media"
        onBack={() => go('sheet')}
        onSelect={(option) => {
          edit(isSonarr
            ? { seriesId: option.id, seasonNumber: undefined, episodeIds: [], pendingEpisodes: undefined, fromSearch: false }
            : { movieId: option.id, fromSearch: false });
          go('sheet');
        }}
      />
    );
  }
  if (screen === 'episodes') {
    return (
      <EpisodePicker
        episodes={seasonEpisodes}
        initial={episodeIds.map((id) => ({ id }))}
        isAnime={isAnime}
        onCancel={() => go('sheet')}
        onConfirm={(eps) => { edit({ episodeIds: eps.map((e) => e.id), pendingEpisodes: undefined, fromSearch: false }); go('sheet'); }}
      />
    );
  }

  return (
    <>
      <Drawer open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
        {/* A short form: only as tall as its rows, and no wider than a phone on tablets and desktops. */}
        <DrawerContent size="content">
          <DrawerHeader className="text-center">
            <DrawerTitle>Manual grab</DrawerTitle>
            <DrawerDescription className="mx-auto line-clamp-2 max-w-md break-all">{release.title}</DrawerDescription>
          </DrawerHeader>
          <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-4">
              {isSonarr ? (
                <>
                  <SheetRow
                    label="Series" value={chosenTitle} placeholder="Choose a series"
                    onPress={canBrowse ? () => go('media') : undefined}
                  />
                  <SheetRow
                    label="Season" value={seasonLabel(draft.seasonNumber)} placeholder="Choose a season"
                    disabled={draft.seriesId === undefined} onPress={() => setDialog('season')}
                  />
                  <SheetRow
                    label="Episodes"
                    value={episodeLabels.length > 0
                      ? <span className="flex flex-col">{episodeLabels.map((e) => <span key={e.id}>{e.text}</span>)}</span>
                      : draft.episodeIds === null && episodesQuery.isLoading ? 'Loading…' : undefined}
                    placeholder="Choose episodes"
                    disabled={draft.seriesId === undefined || draft.seasonNumber === undefined}
                    onPress={() => go('episodes')}
                  />
                </>
              ) : (
                <SheetRow
                  label="Movie" value={chosenTitle} placeholder="Choose a movie"
                  onPress={canBrowse ? () => go('media') : undefined}
                />
              )}
              <SheetRow label="Quality" value={qualityLabel} placeholder="Choose a quality" onPress={() => setDialog('quality')} />
              <SheetRow
                label="Languages" value={draft.languages.map((l) => l.name).join(', ')} placeholder="Choose languages"
                onPress={() => setDialog('language')}
              />
              {protocolClients.length > 1 && (
                <SheetRow label="Download client" value={clientName} placeholder="Default" onPress={() => setDialog('client')} />
              )}
              {draft.fromSearch && (
                <p className="pt-3 text-xs text-muted-foreground">
                  {isSonarr ? 'Series and episodes' : 'Movie'} filled in from your search: {isSonarr ? 'Sonarr' : 'Radarr'} couldn&apos;t match this release itself.
                </p>
              )}
            </div>
            <DrawerFooter>
              {error && (
                <div role="alert" className="flex items-center justify-between gap-3 text-sm text-destructive">
                  <span className="min-w-0 break-words">{error.text}</span>
                  {error.code === 'expired' && (
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => { onClose(); onSearchAgain(); }}>
                      Search again
                    </Button>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" disabled={busy} onClick={onClose}>Cancel</Button>
                <Button className="flex-1" disabled={busy} onClick={() => void grab()}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Grab release
                </Button>
              </div>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>

      {isSonarr && (
        <SeasonPicker
          open={dialog === 'season'}
          episodes={allEpisodes}
          description="Choose the season this release is for."
          onClose={() => setDialog(null)}
          onSelect={(season) => {
            if (season !== draft.seasonNumber) edit({ seasonNumber: season, episodeIds: [], pendingEpisodes: undefined, fromSearch: false });
            setDialog(null);
          }}
        />
      )}
      <QualityPicker
        open={dialog === 'quality'}
        defs={qualityDefs.data ?? []}
        loading={qualityDefs.isLoading}
        initial={draft.quality}
        description="Choose this release's quality."
        onClose={() => setDialog(null)}
        onSelect={(quality) => { edit({ quality }); setDialog(null); }}
      />
      <LanguagePicker
        open={dialog === 'language'}
        languages={languages.data ?? []}
        loading={languages.isLoading}
        initial={draft.languages}
        description="Choose this release's languages."
        onClose={() => setDialog(null)}
        onSelect={(langs) => { edit({ languages: langs }); setDialog(null); }}
      />
      <Dialog open={dialog === 'client'} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Download client</DialogTitle>
            <DialogDescription className="sr-only">Choose the download client for this release.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            {[{ id: null, name: 'Default' } as { id: number | null; name: string }, ...protocolClients].map((client) => (
              <button
                key={client.id ?? 'default'}
                onClick={() => { edit({ downloadClientId: client.id }); setDialog(null); }}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                  draft.downloadClientId === client.id ? 'border-primary bg-primary/10' : 'hover:bg-accent',
                )}
              >
                <span className="min-w-0 truncate text-left font-medium">{client.name}</span>
                {draft.downloadClientId === client.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
