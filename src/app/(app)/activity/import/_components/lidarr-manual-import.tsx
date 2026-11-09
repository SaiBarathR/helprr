'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { jsonFetcher, ensureArray, withInstanceQuery } from '@/lib/query-fetch';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PageSpinner } from '@/components/ui/page-spinner';
import { FloatingActionBar } from '@/components/ui/floating-action-bar';
import { Check, ChevronRight, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { trackManualImport } from '@/lib/manual-import-tracker';
import { SearchInput } from '@/components/media/search-input';
import type { LidarrAlbum, LidarrArtist, LidarrArtistListItem, LidarrTrack, ManualImportItem } from '@/types';

// Lidarr's manual import, as the Sonarr/Radarr page does it: the files Lidarr
// found in the download, each matched to an artist, an album (on one of its
// releases) and tracks. When Lidarr's tag match failed, the user picks the
// artist and album and Lidarr re-matches the tracks on it.

type View = 'files' | 'artists' | 'albums' | 'tracks';

const NO_FILES: ManualImportItem[] = [];

function sortFilesByPath(data: ManualImportItem[]): ManualImportItem[] {
  const pathOf = (f: ManualImportItem) => f.relativePath || f.name || f.path || '';
  return [...ensureArray(data)].sort((a, b) => pathOf(a).localeCompare(pathOf(b), undefined, { numeric: true }));
}

const PICKER_CLASS = 'fixed inset-y-0 right-0 left-[var(--app-main-left,0px)] z-50 flex flex-col bg-background pl-[calc(var(--main-pad-x)+var(--main-inset-left))] pr-[calc(var(--main-pad-x)+var(--main-inset-right))] pt-[calc(env(safe-area-inset-top)+var(--main-pad-top))]';
const SEARCH_CLASS = 'w-full text-sm bg-muted/40 rounded-lg pl-9 pr-3 py-2.5 h-auto shadow-none border-0 outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary/40 transition-shadow';

const trackLabel = (track: LidarrTrack) => `${track.trackNumber || track.absoluteTrackNumber}. ${track.title || 'Untitled'}`;
const isPlaced = (f: ManualImportItem) => Boolean(f.artist?.id && f.album?.id);

export function LidarrManualImport() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const downloadId = searchParams.get('downloadId') || '';
  const instanceId = searchParams.get('instanceId') || '';
  const itemTitle = searchParams.get('title') || 'Manual Import';

  const [submitting, setSubmitting] = useState(false);
  const [excludedPaths, setExcludedPaths] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>('files');
  const [search, setSearch] = useState('');
  // Files given an album by the user: path → file, with what Lidarr worked out for it.
  const [assigned, setAssigned] = useState<Map<string, ManualImportItem>>(new Map());
  const [uncheckedPaths, setUncheckedPaths] = useState<Set<string>>(new Set());
  // Per-file track picks: path → tracks.
  const [trackOverrides, setTrackOverrides] = useState<Map<string, LidarrTrack[]>>(new Map());
  const [pickerPath, setPickerPath] = useState('');
  const [chosenArtist, setChosenArtist] = useState<LidarrArtistListItem | null>(null);
  const [assigning, setAssigning] = useState(false);
  // Bumped per choice and on backing out, so a late answer is recognised and dropped.
  const assignRequest = useRef(0);

  const manualImportPath = (() => {
    const params = new URLSearchParams({ downloadId, source: 'lidarr' });
    if (instanceId) params.set('instanceId', instanceId);
    return `/api/activity/manualimport?${params}`;
  })();

  const { data: scannedFiles = NO_FILES, isLoading: filesLoading, isError: filesError } = useQuery({
    queryKey: ['activity', 'manualimport', { downloadId, source: 'lidarr', instanceId }],
    queryFn: jsonFetcher<ManualImportItem[]>(manualImportPath),
    enabled: Boolean(downloadId),
    select: sortFilesByPath,
  });

  useEffect(() => {
    if (filesError) toast.error('Failed to load import data');
  }, [filesError]);

  const files = useMemo(() => scannedFiles.map((f) => assigned.get(f.path) ?? f), [scannedFiles, assigned]);
  const tracksOf = (f: ManualImportItem) => trackOverrides.get(f.path) ?? f.tracks ?? [];

  // The album choice applies to the files Lidarr could not place; when it placed
  // them all on one album, to every file, since that match may be the wrong album.
  const unplacedFiles = useMemo(() => scannedFiles.filter((f) => !isPlaced(f)), [scannedFiles]);
  const singleAlbum = scannedFiles.length > 0 && new Set(scannedFiles.map((f) => f.album?.id)).size === 1;
  const choiceTargets = unplacedFiles.length > 0 ? unplacedFiles : singleAlbum ? scannedFiles : NO_FILES;
  const shownAlbum = choiceTargets.map((f) => (assigned.get(f.path) ?? f).album).find(Boolean);
  const shownArtist = choiceTargets.map((f) => (assigned.get(f.path) ?? f).artist).find(Boolean);

  const selectedFiles = files.filter((f) => !excludedPaths.has(f.path));
  // A track given to two ticked files: Lidarr would import one and skip the other.
  const sharedTrackIds = (() => {
    const seen = new Set<number>();
    const shared = new Set<number>();
    for (const t of selectedFiles.flatMap(tracksOf)) (seen.has(t.id) ? shared : seen).add(t.id);
    return shared;
  })();
  const missingAssignment = sharedTrackIds.size > 0
    || selectedFiles.some((f) => !isPlaced(f) || !f.albumReleaseId || tracksOf(f).length === 0);

  const { data: artists = [], isLoading: artistsLoading, isError: artistsError } = useQuery({
    queryKey: ['activity', 'manualimport', 'media-options', { source: 'lidarr', instanceId }],
    queryFn: jsonFetcher<LidarrArtistListItem[]>(withInstanceQuery('/api/lidarr', instanceId || undefined)),
    enabled: view === 'artists',
    select: ensureArray,
    staleTime: 60_000,
  });
  const { data: albums = [], isLoading: albumsLoading, isError: albumsError } = useQuery({
    queryKey: ['activity', 'manualimport', 'albums', { artistId: chosenArtist?.id, instanceId }],
    queryFn: jsonFetcher<LidarrAlbum[]>(withInstanceQuery(`/api/lidarr/${chosenArtist?.id}/albums`, instanceId || undefined)),
    enabled: view === 'albums' && Boolean(chosenArtist),
    select: ensureArray,
    staleTime: 60_000,
  });
  const pickerFile = files.find((f) => f.path === pickerPath);
  const { data: releaseTracks = [], isLoading: tracksLoading, isError: tracksError } = useQuery({
    queryKey: ['activity', 'manualimport', 'tracks', { albumReleaseId: pickerFile?.albumReleaseId, instanceId }],
    queryFn: jsonFetcher<LidarrTrack[]>(withInstanceQuery(
      `/api/lidarr/album/${pickerFile?.album?.id}/tracks?albumReleaseId=${pickerFile?.albumReleaseId}`,
      instanceId || undefined,
    )),
    enabled: view === 'tracks' && Boolean(pickerFile?.album?.id && pickerFile?.albumReleaseId),
    select: ensureArray,
  });

  const q = search.trim().toLowerCase();
  const filteredArtists = useMemo(() => artists
    .filter((a) => !q || a.artistName.toLowerCase().includes(q))
    .sort((a, b) => a.artistName.localeCompare(b.artistName)), [artists, q]);
  const filteredAlbums = useMemo(() => albums
    .filter((a) => !q || a.title.toLowerCase().includes(q))
    .sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || '')), [albums, q]);
  const filteredTracks = useMemo(() => releaseTracks
    .filter((t) => !q || trackLabel(t).toLowerCase().includes(q))
    .sort((a, b) => a.mediumNumber - b.mediumNumber || a.absoluteTrackNumber - b.absoluteTrackNumber), [releaseTracks, q]);
  const multiDisc = new Set(releaseTracks.map((t) => t.mediumNumber)).size > 1;

  function openView(next: View) {
    setSearch('');
    setView(next);
  }

  function backToFiles() {
    assignRequest.current++;
    setAssigning(false);
    setChosenArtist(null);
    openView('files');
  }

  function backToArtists() {
    assignRequest.current++;
    setAssigning(false);
    openView('artists');
  }

  /**
   * Gives the files the chosen album and has Lidarr re-match them on it, which
   * is what picks the release and fills in the tracks.
   */
  async function assignAlbum(album: LidarrAlbum) {
    const artist = (chosenArtist ?? album.artist) as LidarrArtist | undefined;
    const targets = choiceTargets;
    // Other files Lidarr already placed on this album fix its release: one album imports on one release.
    const placedRelease = scannedFiles.find((f) => !targets.includes(f) && f.album?.id === album.id && f.albumReleaseId)?.albumReleaseId;
    const request = ++assignRequest.current;
    setAssigning(true);
    try {
      let evaluated = new Map<string, ManualImportItem>();
      try {
        const res = await fetch('/api/activity/manualimport/reprocess', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'lidarr',
            instanceId: instanceId || undefined,
            items: targets.map((f) => ({
              id: f.id,
              path: f.path,
              downloadId,
              artistId: album.artistId,
              albumId: album.id,
              albumReleaseId: placedRelease,
              trackIds: [],
              quality: f.quality,
              releaseGroup: f.releaseGroup,
              indexerFlags: f.indexerFlags,
              disableReleaseSwitching: f.disableReleaseSwitching,
            })),
          }),
        });
        if (!res.ok) throw new Error('reprocess failed');
        evaluated = new Map(ensureArray((await res.json()) as ManualImportItem[]).map((r) => [r.path, r]));
      } catch {
        // A failed check does not undo the user's choice; keep the scanned fields.
      }
      if (request !== assignRequest.current) return;
      // Without Lidarr's answer the album's selected release is the best guess.
      const fallbackRelease = placedRelease ?? album.releases?.find((r) => r.monitored)?.id;
      setUncheckedPaths(new Set(targets.filter((f) => !evaluated.has(f.path)).map((f) => f.path)));
      setAssigned((prev) => {
        const next = new Map(prev);
        for (const f of targets) {
          const r = evaluated.get(f.path);
          next.set(f.path, r
            ? {
              ...f,
              ...(r.quality ? { quality: r.quality } : {}),
              artist: r.artist ?? artist,
              album: r.album ?? album,
              albumReleaseId: r.albumReleaseId || fallbackRelease,
              tracks: r.tracks ?? [],
              rejections: r.rejections ?? [],
            }
            // The scan's "unknown album" rejections no longer apply to the user's choice.
            : { ...f, artist, album, albumReleaseId: fallbackRelease, tracks: [], rejections: [] });
        }
        return next;
      });
      // Track picks were made on the previous album.
      const replaced = new Set(targets.map((f) => f.path));
      setTrackOverrides((prev) => new Map([...prev].filter(([path]) => !replaced.has(path))));
      setChosenArtist(null);
      openView('files');
    } finally {
      if (request === assignRequest.current) setAssigning(false);
    }
  }

  function selectTrack(track: LidarrTrack) {
    setTrackOverrides((prev) => new Map(prev).set(pickerPath, [track]));
    openView('files');
  }

  async function submitImport() {
    if (submitting || selectedFiles.length === 0 || missingAssignment) return;
    setSubmitting(true);
    try {
      const payload = selectedFiles.map((f) => ({
        path: f.path,
        artistId: f.artist?.id,
        albumId: f.album?.id,
        albumReleaseId: f.albumReleaseId,
        trackIds: tracksOf(f).map((t) => t.id),
        quality: f.quality,
        releaseGroup: f.releaseGroup,
        indexerFlags: f.indexerFlags,
        disableReleaseSwitching: f.disableReleaseSwitching,
        downloadId,
      }));
      const res = await fetch('/api/activity/manualimport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The title labels this import in the operation audit.
        body: JSON.stringify({ source: 'lidarr', instanceId: instanceId || undefined, title: itemTitle, files: payload }),
      });
      if (res.ok) {
        const command = (await res.json().catch(() => null)) as { id?: number } | null;
        void trackManualImport(queryClient, {
          service: 'lidarr',
          instanceId: instanceId || undefined,
          downloadId,
          commandId: command?.id,
          title: itemTitle,
        });
        router.back();
      } else {
        // 409: a file is no longer in the download; 400: Lidarr no longer has the album, release or track.
        const data = res.status === 409 || res.status === 400
          ? ((await res.json().catch(() => null)) as { error?: string } | null)
          : null;
        toast.error(data?.error ?? 'Import failed');
      }
    } catch {
      toast.error('Import failed');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Artist / album / track pickers ────────────────────────────────────────

  if (view !== 'files') {
    const picker = view === 'artists'
      ? { title: 'Select Artist', subtitle: itemTitle, placeholder: 'Search artists…' }
      : view === 'albums'
        ? { title: 'Select Album', subtitle: chosenArtist?.artistName, placeholder: 'Search albums…' }
        : { title: 'Select Track', subtitle: pickerFile?.name || pickerFile?.relativePath, placeholder: 'Search tracks…' };
    const loadingList = view === 'artists' ? artistsLoading : view === 'albums' ? albumsLoading : tracksLoading;
    const listError = view === 'artists' ? artistsError : view === 'albums' ? albumsError : tracksError;
    const noun = view === 'artists' ? 'artist' : view === 'albums' ? 'album' : 'track';
    const selectedTrackId = pickerFile ? tracksOf(pickerFile)[0]?.id : undefined;
    const rowClass = (selected: boolean) => `w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:bg-muted/60 disabled:opacity-60 ${selected ? 'bg-primary/8' : 'hover:bg-muted/40'}`;

    return (
      <div className={PICKER_CLASS} style={{ '--header-height': '0px' } as React.CSSProperties}>
        <PageHeader title={picker.title} subtitle={picker.subtitle || undefined} onBack={view === 'artists' ? backToFiles : view === 'albums' ? backToArtists : () => openView('files')}
        />
        <div className="py-2 border-b border-border">
          <SearchInput
            clearable
            value={search}
            onChange={setSearch}
            historyKey="activity-import-media"
            placeholder={picker.placeholder}
            autoFocus
            className={SEARCH_CLASS}
          >
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </SearchInput>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain pb-[var(--footer-height)]">
          {loadingList ? (
            <PageSpinner />
          ) : listError ? (
            <p className="text-center py-12 text-sm text-muted-foreground">Couldn&apos;t load the {noun} list</p>
          ) : view === 'artists' ? (
            filteredArtists.length === 0
              ? <p className="text-center py-12 text-sm text-muted-foreground">No artists match</p>
              : filteredArtists.map((a) => (
                <button key={a.id} onClick={() => { setChosenArtist(a); openView('albums'); }} className={rowClass(shownArtist?.id === a.id)}>
                  <p className="flex-1 min-w-0 text-sm truncate">{a.artistName}</p>
                  {shownArtist?.id === a.id ? <Check className="h-4 w-4 text-primary shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                </button>
              ))
          ) : view === 'albums' ? (
            filteredAlbums.length === 0
              ? <p className="text-center py-12 text-sm text-muted-foreground">No albums match</p>
              : filteredAlbums.map((a) => (
                <button key={a.id} onClick={() => assignAlbum(a)} disabled={assigning} className={rowClass(shownAlbum?.id === a.id)}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{a.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {[a.releaseDate?.slice(0, 4), a.albumType].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {shownAlbum?.id === a.id && <Check className="h-4 w-4 text-primary shrink-0" />}
                </button>
              ))
          ) : filteredTracks.length === 0 ? (
            <p className="text-center py-12 text-sm text-muted-foreground">No tracks match</p>
          ) : (
            filteredTracks.map((t) => (
              <button key={t.id} onClick={() => selectTrack(t)} className={rowClass(t.id === selectedTrackId)}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{trackLabel(t)}</p>
                  {multiDisc && <p className="text-[11px] text-muted-foreground mt-0.5">Disc {t.mediumNumber}</p>}
                </div>
                {t.id === selectedTrackId && <Check className="h-4 w-4 text-primary shrink-0" />}
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  // ── Files view (default) ──────────────────────────────────────────────────

  const loading = Boolean(downloadId) && filesLoading;
  return (
    <div className="animate-content-in">
      <PageHeader
        title="Manual Import"
        subtitle={searchParams.get('title') || undefined}
        onBack={() => router.back()}
      />

      <div>
        {loading ? (
          <PageSpinner />
        ) : files.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-sm">No files detected</p>
          </div>
        ) : (
          <div className="py-3 space-y-3">
            {choiceTargets.length > 0 && (
              <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-muted/30 p-3.5">
                <p className="min-w-0 flex-1 text-sm">
                  {shownAlbum ? (
                    <>Album: <span className="font-medium">{shownAlbum.title}</span>{shownArtist ? ` · ${shownArtist.artistName}` : ''}</>
                  ) : (
                    `Lidarr could not match ${unplacedFiles.length === 1 ? 'this file' : 'these files'} to an album.`
                  )}
                </p>
                <Button
                  size="sm"
                  variant={shownAlbum ? 'outline' : 'default'}
                  className="h-8 shrink-0 text-xs"
                  onClick={() => openView('artists')}
                >
                  {shownAlbum ? 'Change' : 'Choose album'}
                </Button>
              </div>
            )}

            {selectedFiles.length < files.length && (
              <p className="text-xs text-muted-foreground">Unticked files stay in the download folder; Helprr can&apos;t import them later.</p>
            )}

            {files.map((f) => {
              const tracks = tracksOf(f);
              const canPickTrack = Boolean(f.album?.id && f.albumReleaseId);
              return (
                <div key={f.path} className="rounded-xl bg-muted/30 border border-border/40 overflow-hidden">
                  <div className="p-3.5 space-y-2">
                    <label className="flex items-center gap-3 min-h-11 cursor-pointer">
                      <Checkbox
                        aria-label={`Import ${f.name || f.relativePath || f.path}`}
                        checked={!excludedPaths.has(f.path)}
                        disabled={submitting}
                        onCheckedChange={(checked) => setExcludedPaths((prev) => {
                          const next = new Set(prev);
                          if (checked === true) next.delete(f.path);
                          else next.add(f.path);
                          return next;
                        })}
                      />
                      <span className="min-w-0 text-sm font-medium leading-snug break-words">
                        {f.name || f.relativePath || f.path}
                      </span>
                    </label>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {f.quality?.quality?.name && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{f.quality.quality.name}</Badge>
                      )}
                      {f.artist?.artistName && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{f.artist.artistName}</Badge>
                      )}
                      {f.album?.title && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{f.album.title}</Badge>
                      )}
                    </div>

                    {uncheckedPaths.has(f.path) && !excludedPaths.has(f.path) && (
                      <p className="text-xs text-amber-400 light:text-amber-700" role="status">
                        {`Lidarr couldn't check this file against ${f.album?.title}; it will be imported as it is.${tracks.length > 0 ? '' : ' Choose a track before importing.'}`}
                      </p>
                    )}

                    {!excludedPaths.has(f.path) && tracks.some((t) => sharedTrackIds.has(t.id)) && (
                      <p className="text-xs text-destructive">Another ticked file has this track. Change one of them.</p>
                    )}

                    {f.rejections?.length > 0 && (
                      <div className="text-xs text-destructive space-y-0.5">
                        {f.rejections.map((r, ri) => <p key={ri}>{r.reason}</p>)}
                      </div>
                    )}
                  </div>

                  {/* Track assignment row. A file with no album has no tracks to pick from yet. */}
                  <button
                    onClick={() => { setPickerPath(f.path); openView('tracks'); }}
                    disabled={!canPickTrack}
                    className="w-full flex items-center gap-2 px-3.5 py-2.5 bg-muted/20 border-t border-border/30 transition-colors active:bg-muted/40"
                  >
                    <div className="flex-1 min-w-0 text-left">
                      {tracks.length > 0 ? (
                        <span className="text-xs text-muted-foreground truncate block">{tracks.map(trackLabel).join(', ')}</span>
                      ) : (
                        <span className="text-xs text-destructive font-medium">No track assigned</span>
                      )}
                    </div>
                    {canPickTrack && (
                      <>
                        <span className="text-xs text-primary font-medium shrink-0">Change</span>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!loading && files.length > 0 && (
        <FloatingActionBar className="p-2">
          <Button
            onClick={submitImport}
            disabled={submitting || selectedFiles.length === 0 || missingAssignment}
            className="w-full h-11"
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Import {selectedFiles.length} {selectedFiles.length === 1 ? 'File' : 'Files'}
          </Button>
        </FloatingActionBar>
      )}
    </div>
  );
}
