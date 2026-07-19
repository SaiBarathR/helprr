'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { arrMutationFetch } from '@/lib/query-fetch';
import { handleAuthError } from '@/lib/query-client';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/page-spinner';
import { PageHeader } from '@/components/layout/page-header';
import { InteractiveSearchDialog } from '@/components/media/interactive-search-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Bookmark,
  BookmarkCheck,
  MoreHorizontal,
  Search,
  Loader2,
  Star,
  Disc3,
  Music,
  ExternalLink,
  ChevronDown,
  Check,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { getImageUrl } from '@/components/media/media-card';
import { format } from 'date-fns';
import type { LidarrAlbum, LidarrTrack, LidarrTrackFile } from '@/types';
import { isProtectedApiImageSrc } from '@/lib/image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getDetailViewState,
  setDetailViewState,
  waitForScrollY,
  type DetailViewKey,
} from '@/lib/detail-view-state';
import { useExternalUrlResolver } from '@/lib/hooks/use-external-urls';
import { formatBytes } from '@/lib/format';
import { useCan } from '@/components/permission-provider';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  QuickContextMenu,
  type ContextAction,
  type ContextActionGroup,
} from '@/components/ui/quick-context-menu';

function formatDuration(ms?: number): string {
  if (!ms) return '';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}


export default function AlbumDetailPage() {
  const { albumId: albumIdParam } = useParams();
  const albumId = Number(albumIdParam);
  const instance = useSearchParams().get('instance') ?? undefined;
  const router = useRouter();
  const queryClient = useQueryClient();
  const detailViewKey: DetailViewKey = `album:${albumId}`;
  const scrollReadyRef = useRef(false);
  const hasRestoredScrollRef = useRef(false);

  // Album + tracks + files — TanStack cache gives instant back-nav (gcTime),
  // replacing the bespoke album snapshot. Instance-scoped: album ids repeat
  // across Lidarr instances, so the key (and the monitor write below) must
  // include the viewing instance.
  const albumKey = ['lidarr', 'album', instance ?? 'default', albumId] as const;
  const albumQuery = useQuery({
    queryKey: albumKey,
    queryFn: async ({ signal }) => {
      const [album, tracks, trackFiles] = await Promise.all([
        arrMutationFetch(instance, `/api/lidarr/album/${albumId}`, { signal }).then(async (r): Promise<LidarrAlbum | null> => (r.ok ? (await r.json() as LidarrAlbum) : null)),
        arrMutationFetch(instance, `/api/lidarr/album/${albumId}/tracks`, { signal }).then(async (r): Promise<LidarrTrack[]> => (r.ok ? (await r.json() as LidarrTrack[]) : [])),
        arrMutationFetch(instance, `/api/lidarr/trackfile?albumId=${albumId}`, { signal }).then(async (r): Promise<LidarrTrackFile[]> => (r.ok ? (await r.json() as LidarrTrackFile[]) : [])),
      ]);
      return { album, tracks, trackFiles };
    },
    enabled: Number.isFinite(albumId),
  });
  const album = albumQuery.data?.album ?? null;
  const tracks = useMemo(() => albumQuery.data?.tracks ?? [], [albumQuery.data]);
  const trackFiles = useMemo(() => albumQuery.data?.trackFiles ?? [], [albumQuery.data]);
  const loading = albumQuery.isLoading;
  const [actionLoading, setActionLoading] = useState('');
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [interactiveSearch, setInteractiveSearch] = useState(false);
  const [expandedTrack, setExpandedTrack] = useState<number | null>(null);
  const [showReleases, setShowReleases] = useState(false);
  const [selectingRelease, setSelectingRelease] = useState<number | null>(null);
  const [deleteAlbumOpen, setDeleteAlbumOpen] = useState(false);
  const [deleteAlbumFiles, setDeleteAlbumFiles] = useState(false);
  const [deleteTrack, setDeleteTrack] = useState<{ track: LidarrTrack; file: LidarrTrackFile } | null>(null);
  const lidarrExternalUrl = useExternalUrlResolver()('LIDARR', instance);

  const canEditMonitoring = useCan('music.editMonitoring');
  const canManageActivity = useCan('activity.manage');
  const canDelete = useCan('music.delete');

  // Reset scroll-restore guards whenever the album/instance changes.
  useEffect(() => {
    scrollReadyRef.current = false;
    hasRestoredScrollRef.current = false;
  }, [albumId, instance]);

  useEffect(() => {
    if (loading || !album || hasRestoredScrollRef.current) return;
    const saved = getDetailViewState(detailViewKey);
    if (!saved || saved.scrollY <= 0) {
      hasRestoredScrollRef.current = true;
      scrollReadyRef.current = true;
      return;
    }
    let cancelled = false;
    void (async () => {
      await waitForScrollY(saved.scrollY);
      if (cancelled) return;
      window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
      hasRestoredScrollRef.current = true;
      scrollReadyRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [detailViewKey, loading, album]);

  useEffect(() => {
    const persistScroll = () => {
      if (!scrollReadyRef.current) return;
      setDetailViewState(detailViewKey, { scrollY: window.scrollY });
    };
    let lastSaved = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - lastSaved < 150) return;
      lastSaved = now;
      persistScroll();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', persistScroll);
    return () => {
      persistScroll();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', persistScroll);
    };
  }, [detailViewKey, loading, album]);

  async function handleSearch() {
    if (!album) return;
    setActionLoading('search');
    try {
      const res = await arrMutationFetch(instance, '/api/lidarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'AlbumSearch', albumIds: [album.id] }),
      });
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      toast.success('Search started');
    } catch (e) { handleAuthError(e); toast.error('Search failed'); }
    finally { setActionLoading(''); }
  }

  async function handleToggleMonitored() {
    if (!album) return;
    setActionLoading('monitor');
    const next = !album.monitored;
    try {
      const res = await arrMutationFetch(instance, '/api/lidarr/album/monitor', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albumIds: [album.id], monitored: next }),
      });
      if (res.ok) {
        const updated = { ...album, monitored: next };
        queryClient.setQueryData(
          albumKey,
          (prev: { album: LidarrAlbum | null; tracks: LidarrTrack[]; trackFiles: LidarrTrackFile[] } | undefined) =>
            prev ? { ...prev, album: updated } : prev,
        );
        toast.success(next ? 'Now monitored' : 'Unmonitored');
      } else { toast.error('Failed to update'); }
    } catch (e) { handleAuthError(e); toast.error('Failed to update'); }
    finally { setActionLoading(''); }
  }

  async function handleSelectRelease(releaseId: number) {
    if (!album) return;
    setSelectingRelease(releaseId);
    try {
      const updated: LidarrAlbum = {
        ...album,
        anyReleaseOk: false,
        releases: album.releases.map((r) => ({ ...r, monitored: r.id === releaseId })),
      };
      const res = await arrMutationFetch(instance, `/api/lidarr/album/${album.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        toast.success('Release selected');
        await albumQuery.refetch();
      } else { toast.error('Failed to select release'); }
    } catch (e) { handleAuthError(e); toast.error('Failed to select release'); }
    finally { setSelectingRelease(null); }
  }

  async function handleDeleteAlbum() {
    if (!album) return;
    setActionLoading('delete-album');
    try {
      const res = await arrMutationFetch(
        instance,
        `/api/lidarr/album/${album.id}?deleteFiles=${deleteAlbumFiles}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      toast.success('Album deleted');
      queryClient.removeQueries({ queryKey: albumKey });
      router.replace(`/music/${album.artistId}${instance ? `?instance=${instance}` : ''}`);
    } catch (e) {
      handleAuthError(e);
      toast.error('Failed to delete album');
    } finally {
      setActionLoading('');
    }
  }

  async function handleDeleteTrackFile() {
    if (!album || !deleteTrack) return;
    setActionLoading(`delete-track-${deleteTrack.track.id}`);
    try {
      const res = await arrMutationFetch(instance, '/api/lidarr/trackfile', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artistId: album.artistId,
          trackFileIds: [deleteTrack.file.id],
          mediaTitle: `${artistName ?? 'Unknown artist'} — ${album.title}`,
        }),
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      queryClient.setQueryData(
        albumKey,
        (prev: { album: LidarrAlbum | null; tracks: LidarrTrack[]; trackFiles: LidarrTrackFile[] } | undefined) =>
          prev ? {
            ...prev,
            tracks: prev.tracks.map((track) => track.id === deleteTrack.track.id
              ? { ...track, hasFile: false, trackFileId: 0 }
              : track),
            trackFiles: prev.trackFiles.filter((file) => file.id !== deleteTrack.file.id),
          } : prev,
      );
      toast.success('Track file deleted');
      setExpandedTrack(null);
      setDeleteTrack(null);
    } catch (e) {
      handleAuthError(e);
      toast.error('Failed to delete track file');
    } finally {
      setActionLoading('');
    }
  }

  const filesByTrackId = useMemo(() => {
    const map = new Map<number, LidarrTrackFile>();
    for (const f of trackFiles) map.set(f.id, f);
    return map;
  }, [trackFiles]);

  const mediaGroups = useMemo(() => {
    const groups = new Map<number, LidarrTrack[]>();
    for (const t of tracks) {
      const arr = groups.get(t.mediumNumber) ?? [];
      arr.push(t);
      groups.set(t.mediumNumber, arr);
    }
    return [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([medium, items]) => ({
        medium,
        tracks: items.sort((a, b) => Number(a.trackNumber) - Number(b.trackNumber)),
      }));
  }, [tracks]);

  if (loading && !album) {
    return <><PageHeader title="Album" /><PageSpinner /></>;
  }

  if (!album) {
    return <div className="text-center py-12 text-muted-foreground">Album not found</div>;
  }

  const cover = getImageUrl(album.images, 'cover', 'lidarr');
  const year = album.releaseDate ? new Date(album.releaseDate).getFullYear() : null;
  const stats = album.statistics;
  const rating = album.ratings?.value ?? 0;
  const artistName = album.artist?.artistName;
  const labels = [...new Set(album.releases.flatMap((r) => r.label ?? []))];
  const countries = [...new Set(album.releases.flatMap((r) => r.country ?? []))];
  const formats = [...new Set(album.releases.map((r) => r.format).filter(Boolean))];
  const complete = !!stats && stats.totalTrackCount > 0 && stats.trackFileCount >= stats.totalTrackCount;

  const infoRows: { label: string; value: string }[] = [
    ...(album.releaseDate ? [{ label: 'Released', value: format(new Date(album.releaseDate), 'MMM d, yyyy') }] : []),
    { label: 'Type', value: [album.albumType, ...(album.secondaryTypes ?? [])].filter(Boolean).join(', ') },
    ...(labels.length ? [{ label: 'Label', value: labels.join(', ') }] : []),
    ...(countries.length ? [{ label: 'Country', value: countries.join(', ') }] : []),
    ...(formats.length ? [{ label: 'Format', value: formats.join(', ') }] : []),
    ...(album.mediumCount > 0 ? [{ label: 'Discs', value: String(album.mediumCount) }] : []),
    ...(album.duration ? [{ label: 'Duration', value: formatDuration(album.duration) }] : []),
    ...(stats ? [{ label: 'Tracks', value: `${stats.trackFileCount} / ${stats.totalTrackCount}` }] : []),
    ...(stats && stats.sizeOnDisk > 0 ? [{ label: 'Size on Disk', value: formatBytes(stats.sizeOnDisk) }] : []),
  ];

  const albumContextGroups: ContextActionGroup[] = [
    {
      id: 'activity',
      actions: [
        ...(canEditMonitoring ? [{
          id: 'monitor',
          label: album.monitored ? 'Unmonitor album' : 'Monitor album',
          icon: album.monitored ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />,
          onSelect: () => { void handleToggleMonitored(); },
          disabled: actionLoading === 'monitor',
        }] : []),
        ...(canManageActivity ? [
          { id: 'search', label: 'Automatic Search', icon: <Search className="h-4 w-4" />, onSelect: () => { void handleSearch(); }, disabled: !!actionLoading },
          { id: 'interactive', label: 'Interactive Search', icon: <Search className="h-4 w-4" />, onSelect: () => setInteractiveSearch(true) },
        ] : []),
      ],
    },
    {
      id: 'links',
      actions: [
        ...(lidarrExternalUrl && album.foreignAlbumId ? [{ id: 'lidarr', label: 'Open in Lidarr', icon: <Disc3 className="h-4 w-4" />, href: `${lidarrExternalUrl}/album/${album.foreignAlbumId}`, external: true }] : []),
        ...(album.foreignAlbumId ? [{ id: 'musicbrainz', label: 'Open in MusicBrainz', icon: <ExternalLink className="h-4 w-4" />, href: `https://musicbrainz.org/release-group/${album.foreignAlbumId}`, external: true }] : []),
      ],
    },
    ...(canDelete ? [{
      id: 'danger',
      actions: [{
        id: 'delete',
        label: 'Delete Album…',
        icon: <Trash2 className="h-4 w-4" />,
        onSelect: () => {
          setDeleteAlbumFiles(false);
          setDeleteAlbumOpen(true);
        },
        destructive: true,
      }],
    }] : []),
  ];

  return (
    <>
      <PageHeader
        title={album.title}
        subtitle={artistName}
        rightContent={
          <>
            {canEditMonitoring && (
              <button
                onClick={handleToggleMonitored}
                disabled={actionLoading === 'monitor'}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary"
                aria-label="Toggle monitored"
              >
                {actionLoading === 'monitor' ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : album.monitored ? (
                  <BookmarkCheck className="h-5 w-5 fill-primary" />
                ) : (
                  <Bookmark className="h-5 w-5" />
                )}
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary">
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {canManageActivity && (
                  <DropdownMenuItem onClick={handleSearch} disabled={!!actionLoading}>
                    <Search className="h-4 w-4" />
                    Automatic Search
                  </DropdownMenuItem>
                )}
                {canManageActivity && (
                  <DropdownMenuItem onClick={() => setInteractiveSearch(true)}>
                    <Search className="h-4 w-4" />
                    Interactive Search
                  </DropdownMenuItem>
                )}
                {lidarrExternalUrl && album.foreignAlbumId && (
                  <DropdownMenuItem asChild>
                    <a href={`${lidarrExternalUrl}/album/${album.foreignAlbumId}`} target="_blank" rel="noopener noreferrer">
                      <Disc3 className="h-4 w-4" />
                      Open in Lidarr
                    </a>
                  </DropdownMenuItem>
                )}
                {album.foreignAlbumId && (
                  <DropdownMenuItem onClick={() => window.open(`https://musicbrainz.org/release-group/${album.foreignAlbumId}`, '_blank')}>
                    <ExternalLink className="h-4 w-4" />
                    Open in MusicBrainz
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => {
                      setDeleteAlbumFiles(false);
                      setDeleteAlbumOpen(true);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete Album
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="space-y-6 animate-content-in">
        {/* Hero — pt-3 keeps the cover clear of the flush page header. */}
        <div className="flex gap-4 pt-3">
          <div className="w-[130px] shrink-0">
            <QuickContextMenu label={`${album.title} actions`} groups={albumContextGroups}>
            <div className="relative aspect-square rounded-lg overflow-hidden bg-muted shadow-sm">
              {cover ? (
                <Image src={cover} alt={album.title} fill sizes="130px" className="object-cover" unoptimized={isProtectedApiImageSrc(cover)} />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground"><Disc3 className="h-10 w-10" /></div>
              )}
              {album.monitored === false && <div className="absolute inset-0 bg-black/35" />}
            </div>
            </QuickContextMenu>
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <Badge
              className={`mb-1.5 text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 ${complete ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}
              variant="outline"
            >
              {complete ? 'Complete' : 'Missing tracks'}
            </Badge>
            <h1 className="text-xl font-bold leading-tight line-clamp-2">{album.title}</h1>
            {artistName && (
              <Link href={`/music/${album.artistId}${instance ? `?instance=${instance}` : ''}`} className="text-sm text-primary mt-0.5 inline-block hover:underline">
                {artistName}
              </Link>
            )}
            <p className="text-sm text-muted-foreground mt-1">
              {[year, album.albumType].filter(Boolean).join(' · ')}
            </p>
            {rating > 0 && (
              <div className="flex items-center gap-1 mt-2">
                <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                <span className="text-sm font-semibold">{rating.toFixed(1)}</span>
                {album.ratings?.votes ? <span className="text-[10px] text-muted-foreground">{album.ratings.votes} votes</span> : null}
              </div>
            )}
          </div>
        </div>

        {/* Genres */}
        {album.genres?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {album.genres.slice(0, 10).map((g) => (
              <Badge key={g} variant="secondary" className="text-[10px] px-1.5 py-0">{g}</Badge>
            ))}
          </div>
        )}

        {/* Overview */}
        {album.overview && (
          <div>
            <p className={`text-sm text-muted-foreground leading-relaxed ${!overviewExpanded ? 'line-clamp-3' : ''}`}>
              {album.overview}
            </p>
            <button onClick={() => setOverviewExpanded(!overviewExpanded)} className="text-sm text-primary font-medium mt-1">
              {overviewExpanded ? 'less' : 'more...'}
            </button>
          </div>
        )}

        {/* Action buttons */}
        {canManageActivity && (
          <div className="flex gap-3">
            <Button onClick={handleSearch} disabled={!!actionLoading} className="flex-1 rounded-full h-10" variant="secondary">
              {actionLoading === 'search' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
              Automatic
            </Button>
            <Button onClick={() => setInteractiveSearch(true)} className="flex-1 rounded-full h-10" variant="secondary">
              <Search className="h-4 w-4 mr-2" />
              Interactive
            </Button>
          </div>
        )}

        {/* Information */}
        <div>
          <h2 className="text-base font-semibold mb-2">Information</h2>
          <div>
            {infoRows.map((row) => (
              <div key={row.label} className="flex justify-between items-start py-2.5 border-b border-border/40 last:border-b-0">
                <span className="text-sm text-muted-foreground shrink-0">{row.label}</span>
                <span className="text-sm text-right ml-4 truncate max-w-[60%]">{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Release selection */}
        {album.releases.length > 1 && (
          <div>
            <button
              onClick={() => setShowReleases((v) => !v)}
              className="flex items-center gap-1.5 text-base font-semibold mb-2"
            >
              Releases ({album.releases.length})
              <ChevronDown className={`h-4 w-4 transition-transform ${showReleases ? 'rotate-180' : ''}`} />
            </button>
            {showReleases && (
              <div className="space-y-1.5">
                {album.releases.map((release) => {
                  const selected = release.monitored;
                  return (
                    <button
                      key={release.id}
                      onClick={() => canEditMonitoring && !selected && handleSelectRelease(release.id)}
                      disabled={!canEditMonitoring || selectingRelease !== null}
                      className={`w-full text-left rounded-lg border p-2.5 text-sm transition-colors ${selected ? 'border-primary bg-primary/10' : 'border-border/50 hover:bg-accent/30'} disabled:opacity-70`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex-1 min-w-0 truncate font-medium">
                          {release.title}{release.disambiguation ? ` (${release.disambiguation})` : ''}
                        </span>
                        {selectingRelease === release.id ? (
                          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                        ) : selected ? (
                          <Check className="h-4 w-4 text-primary shrink-0" />
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                        <span>{release.trackCount} tracks</span>
                        {release.format && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{release.format}</Badge>}
                        {(release.country ?? []).slice(0, 1).map((c) => <span key={c}>{c}</span>)}
                        {(release.label ?? []).slice(0, 1).map((l) => <span key={l} className="truncate max-w-[140px]">{l}</span>)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tracklist */}
        <div className="space-y-4">
          <h2 className="text-base font-semibold">Tracks</h2>
          {mediaGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tracks found.</p>
          ) : (
            mediaGroups.map((group) => (
              <div key={group.medium} className="space-y-1">
                {album.mediumCount > 1 && (
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Disc3 className="h-3.5 w-3.5" /> Disc {group.medium}
                  </h3>
                )}
                <div className="rounded-xl bg-card overflow-hidden divide-y divide-border/40">
                  {group.tracks.map((track) => {
                    const file = track.trackFileId ? filesByTrackId.get(track.trackFileId) : undefined;
                    const isExpanded = expandedTrack === track.id;
                    const trackActions: ContextAction[] = [
                      ...(canManageActivity ? [{
                        id: 'interactive',
                        label: 'Interactive search…',
                        icon: <Search className="h-4 w-4" />,
                        onSelect: () => setInteractiveSearch(true),
                      }] : []),
                      ...(file ? [
                      {
                        id: 'details',
                        label: isExpanded ? 'Hide file details' : 'Show file details',
                        icon: <ChevronDown className={`h-4 w-4 ${isExpanded ? 'rotate-180' : ''}`} />,
                        onSelect: () => setExpandedTrack(isExpanded ? null : track.id),
                      },
                      ...(canDelete ? [{
                        id: 'delete',
                        label: 'Delete Track File…',
                        icon: <Trash2 className="h-4 w-4" />,
                        onSelect: () => setDeleteTrack({ track, file }),
                        destructive: true,
                      }] : []),
                    ] : []),
                    ];
                    return (
                      <div key={track.id}>
                        <QuickContextMenu label={`${track.title} actions`} actions={trackActions.length > 0 ? trackActions : undefined} disabled={trackActions.length === 0}>
                        <button
                          onClick={() => setExpandedTrack(isExpanded ? null : (file ? track.id : null))}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/20 transition-colors"
                        >
                          <span className="w-6 text-xs text-muted-foreground text-right shrink-0">{track.trackNumber}</span>
                          <span
                            className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${track.hasFile ? 'bg-green-500' : 'bg-muted-foreground/40'}`}
                          />
                          <span className="flex-1 min-w-0 text-sm truncate">{track.title}</span>
                          {track.explicit && <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">E</Badge>}
                          {file?.quality?.quality?.name && (
                            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0 hidden sm:inline-flex">{file.quality.quality.name}</Badge>
                          )}
                          <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{formatDuration(track.duration)}</span>
                          {file && <MoreVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                        </button>
                        </QuickContextMenu>
                        {isExpanded && file && (
                          <div className="px-3 pb-3 pt-1 ml-9 space-y-1 text-xs text-muted-foreground">
                            {file.mediaInfo?.audioCodec && (
                              <div className="flex items-center gap-2 flex-wrap">
                                <Music className="h-3 w-3" />
                                <span>{[
                                  file.mediaInfo.audioCodec,
                                  file.mediaInfo.audioBits,
                                  file.mediaInfo.audioSampleRate,
                                  file.mediaInfo.audioBitRate,
                                  file.mediaInfo.audioChannels ? `${file.mediaInfo.audioChannels}ch` : null,
                                ].filter(Boolean).join(' · ')}</span>
                              </div>
                            )}
                            {file.size > 0 && <div>Size: {formatBytes(file.size)}</div>}
                            {file.path && <div className="font-mono break-all">{file.path}</div>}
                            {canDelete && (
                              <Button
                                variant="destructive"
                                size="sm"
                                className="mt-2"
                                onClick={() => setDeleteTrack({ track, file })}
                              >
                                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                Delete Track File
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <InteractiveSearchDialog
        open={interactiveSearch}
        onOpenChange={setInteractiveSearch}
        title={album.title}
        service="lidarr"
        searchParams={{ albumId: album.id, ...(instance ? { instanceId: instance } : {}) }}
      />
      <AlertDialog open={deleteAlbumOpen} onOpenChange={setDeleteAlbumOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {album.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the album from Lidarr. Choose whether its downloaded track files should also be deleted from disk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={deleteAlbumFiles}
              disabled={actionLoading === 'delete-album'}
              onCheckedChange={(value) => setDeleteAlbumFiles(value === true)}
            />
            <span>Delete downloaded track files from disk</span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading === 'delete-album'}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={actionLoading === 'delete-album'}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteAlbum();
              }}
            >
              {actionLoading === 'delete-album' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Album
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteTrack !== null} onOpenChange={(open) => { if (!open) setDeleteTrack(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete track file?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTrack ? `“${deleteTrack.track.title}” will be deleted from disk. Lidarr will keep the track and mark it as missing.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading.startsWith('delete-track-')}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={actionLoading.startsWith('delete-track-')}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteTrackFile();
              }}
            >
              {actionLoading.startsWith('delete-track-') && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Track File
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
