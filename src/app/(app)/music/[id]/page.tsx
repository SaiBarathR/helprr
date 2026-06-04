'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/page-spinner';
import { PageHeader } from '@/components/layout/page-header';
import { RenamePreviewDialog } from '@/components/media/rename-preview-dialog';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Bookmark,
  BookmarkCheck,
  MoreHorizontal,
  Search,
  RefreshCw,
  Trash2,
  Pencil,
  Loader2,
  Star,
  Disc3,
  FileText,
  FileEdit,
  ExternalLink,
  Eye,
  EyeOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { getImageUrl } from '@/components/media/media-card';
import { format } from 'date-fns';
import type { LidarrArtist, LidarrAlbum, QualityProfile, LidarrMetadataProfile, Tag } from '@/types';
import { isProtectedApiImageSrc } from '@/lib/image';
import {
  getArtistDetailSnapshot,
  setArtistDetailSnapshot,
} from '@/lib/music-route-cache';
import {
  getDetailViewState,
  setDetailViewState,
  waitForScrollY,
  type DetailViewKey,
} from '@/lib/detail-view-state';
import { useExternalUrls } from '@/lib/hooks/use-external-urls';
import { formatBytes } from '@/lib/format';
import { useCan } from '@/components/permission-provider';

// Known external providers surfaced as link chips (deduped by name, first wins).
const LINK_LABELS: Record<string, string> = {
  musicbrainz: 'MusicBrainz',
  spotify: 'Spotify',
  last: 'Last.fm',
  lastfm: 'Last.fm',
  discogs: 'Discogs',
  allmusic: 'AllMusic',
  wikidata: 'Wikidata',
  wikipedia: 'Wikipedia',
  imdb: 'IMDb',
  youtube: 'YouTube',
  deezer: 'Deezer',
  apple: 'Apple Music',
  tidal: 'Tidal',
  bandcamp: 'Bandcamp',
  genius: 'Genius',
  rateyourmusic: 'RateYourMusic',
  soundcloud: 'SoundCloud',
};

const ALBUM_TYPE_ORDER = ['Album', 'EP', 'Single', 'Broadcast', 'Other'];

function albumYear(album: LidarrAlbum): number | null {
  if (!album.releaseDate) return null;
  const y = new Date(album.releaseDate).getFullYear();
  return Number.isFinite(y) ? y : null;
}

export default function ArtistDetailPage() {
  const { id } = useParams();
  const artistId = Number(id);
  const initialSnapshot = Number.isFinite(artistId) ? getArtistDetailSnapshot(artistId) : null;
  const detailViewKey: DetailViewKey = `artist:${artistId}`;
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const scrollReadyRef = useRef(false);
  const hasRestoredScrollRef = useRef(false);
  // Guards against a stale loadData (older artist) resolving after a newer one.
  const loadRequestRef = useRef(0);
  const router = useRouter();

  const [artist, setArtist] = useState<LidarrArtist | null>(() => initialSnapshot?.artist ?? null);
  const [albums, setAlbums] = useState<LidarrAlbum[]>(() => initialSnapshot?.albums ?? []);
  const [qualityProfiles, setQualityProfiles] = useState<QualityProfile[]>(() => initialSnapshot?.qualityProfiles ?? []);
  const [metadataProfiles, setMetadataProfiles] = useState<LidarrMetadataProfile[]>(() => initialSnapshot?.metadataProfiles ?? []);
  const [tags, setTags] = useState<Tag[]>(() => initialSnapshot?.tags ?? []);
  const [loading, setLoading] = useState(() => !initialSnapshot);
  const [deleting, setDeleting] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [showRenamePreview, setShowRenamePreview] = useState(false);
  const [albumMonitorPending, setAlbumMonitorPending] = useState<number | null>(null);
  const externalUrls = useExternalUrls();

  const canEditMonitoring = useCan('music.editMonitoring');
  const canEditTags = useCan('music.editTags');
  const canChangePath = useCan('music.changePath');
  const canManageActivity = useCan('activity.manage');
  const canDeleteArtist = useCan('music.delete');
  const canEditArtist = canEditMonitoring || canEditTags || canChangePath;

  const getCurrentScrollY = useCallback(() => {
    const content = contentScrollRef.current;
    if (content) {
      const maxScroll = Math.max(0, content.scrollHeight - content.clientHeight);
      if (maxScroll > 0 || content.scrollTop > 0) return content.scrollTop;
    }
    if (typeof window === 'undefined') return 0;
    return window.scrollY;
  }, []);

  const loadData = useCallback(async (hasCachedData: boolean) => {
    if (!Number.isFinite(artistId)) {
      setLoading(false);
      return;
    }
    if (hasCachedData) setLoading(false);

    const requestId = ++loadRequestRef.current;
    try {
      const [artistResult, nextAlbums, nextQp, nextMp, nextTags] = await Promise.all([
        fetch(`/api/lidarr/${artistId}`).then(async (r): Promise<LidarrArtist | null> => (r.ok ? (await r.json() as LidarrArtist) : null)),
        fetch(`/api/lidarr/${artistId}/albums`).then(async (r): Promise<LidarrAlbum[]> => (r.ok ? (await r.json() as LidarrAlbum[]) : [])),
        fetch('/api/lidarr/qualityprofiles').then(async (r): Promise<QualityProfile[]> => (r.ok ? (await r.json() as QualityProfile[]) : [])),
        fetch('/api/lidarr/metadataprofiles').then(async (r): Promise<LidarrMetadataProfile[]> => (r.ok ? (await r.json() as LidarrMetadataProfile[]) : [])),
        fetch('/api/lidarr/tags').then(async (r): Promise<Tag[]> => (r.ok ? (await r.json() as Tag[]) : [])),
      ]);

      if (requestId !== loadRequestRef.current) return;
      setArtist(artistResult);
      setAlbums(nextAlbums);
      setQualityProfiles(nextQp);
      setMetadataProfiles(nextMp);
      setTags(nextTags);
      setArtistDetailSnapshot(artistId, {
        artist: artistResult,
        albums: nextAlbums,
        qualityProfiles: nextQp,
        metadataProfiles: nextMp,
        tags: nextTags,
      });
    } catch {
      if (requestId !== loadRequestRef.current) return;
      if (!hasCachedData) {
        setArtist(null);
        setAlbums([]);
      }
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [artistId]);

  useEffect(() => {
    const cached = Number.isFinite(artistId) ? getArtistDetailSnapshot(artistId) : null;
    scrollReadyRef.current = false;
    hasRestoredScrollRef.current = false;

    if (cached) {
      setArtist(cached.artist);
      setAlbums(cached.albums);
      setQualityProfiles(cached.qualityProfiles);
      setMetadataProfiles(cached.metadataProfiles);
      setTags(cached.tags);
      setLoading(false);
    } else {
      setLoading(true);
    }

    void loadData(Boolean(cached));
  }, [loadData, artistId]);

  useEffect(() => {
    if (loading || !artist || hasRestoredScrollRef.current) return;
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

    return () => {
      cancelled = true;
    };
  }, [detailViewKey, loading, artist]);

  useEffect(() => {
    const persistScroll = () => {
      if (!scrollReadyRef.current) return;
      setDetailViewState(detailViewKey, { scrollY: getCurrentScrollY() });
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
  }, [detailViewKey, getCurrentScrollY, loading, artist]);

  const persistArtist = useCallback((next: LidarrArtist) => {
    setArtist(next);
    if (!Number.isFinite(artistId)) return;
    setArtistDetailSnapshot(artistId, {
      artist: next,
      albums,
      qualityProfiles,
      metadataProfiles,
      tags,
    });
  }, [albums, artistId, metadataProfiles, qualityProfiles, tags]);

  async function handleSearch() {
    if (!artist) return;
    setActionLoading('search');
    try {
      const res = await fetch('/api/lidarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'ArtistSearch', artistId: artist.id }),
      });
      if (res.ok) toast.success('Search started');
      else toast.error('Search failed');
    } catch { toast.error('Search failed'); }
    finally { setActionLoading(''); }
  }

  async function handleRefresh() {
    if (!artist) return;
    setActionLoading('refresh');
    try {
      const res = await fetch('/api/lidarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'RefreshArtist', artistId: artist.id }),
      });
      if (res.ok) toast.success('Refresh started');
      else toast.error('Refresh failed');
    } catch { toast.error('Refresh failed'); }
    finally { setActionLoading(''); }
  }

  async function handleToggleMonitored() {
    if (!artist) return;
    setActionLoading('monitor');
    try {
      const res = await fetch(`/api/lidarr/${artist.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...artist, monitored: !artist.monitored }),
      });
      if (res.ok) {
        const updated = await res.json();
        persistArtist(updated);
        toast.success(updated.monitored ? 'Now monitored' : 'Unmonitored');
      } else {
        toast.error('Failed to update');
      }
    } catch { toast.error('Failed to update'); }
    finally { setActionLoading(''); }
  }

  async function handleToggleAlbumMonitored(album: LidarrAlbum) {
    setAlbumMonitorPending(album.id);
    const nextMonitored = !album.monitored;
    try {
      const res = await fetch('/api/lidarr/album/monitor', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albumIds: [album.id], monitored: nextMonitored }),
      });
      if (res.ok) {
        const nextAlbums = albums.map((a) => (a.id === album.id ? { ...a, monitored: nextMonitored } : a));
        setAlbums(nextAlbums);
        if (Number.isFinite(artistId) && artist) {
          setArtistDetailSnapshot(artistId, { artist, albums: nextAlbums, qualityProfiles, metadataProfiles, tags });
        }
      } else {
        toast.error('Failed to update album');
      }
    } catch { toast.error('Failed to update album'); }
    finally { setAlbumMonitorPending(null); }
  }

  async function handleDelete() {
    if (!artist) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/lidarr/${artist.id}?deleteFiles=${deleteFiles}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Artist deleted');
        router.push('/music');
      } else {
        toast.error('Delete failed');
      }
    } catch { toast.error('Delete failed'); }
    finally { setDeleting(false); }
  }

  const linkChips = useMemo(() => {
    if (!artist) return [] as { label: string; url: string }[];
    const chips: { label: string; url: string }[] = [];
    const seen = new Set<string>();
    if (artist.foreignArtistId) {
      chips.push({ label: 'MusicBrainz', url: `https://musicbrainz.org/artist/${artist.foreignArtistId}` });
      seen.add('musicbrainz');
    }
    for (const link of artist.links ?? []) {
      const key = link.name?.toLowerCase();
      if (!key || seen.has(key)) continue;
      const label = LINK_LABELS[key];
      if (!label) continue;
      seen.add(key);
      chips.push({ label, url: link.url });
    }
    return chips;
  }, [artist]);

  const groupedAlbums = useMemo(() => {
    const groups = new Map<string, LidarrAlbum[]>();
    for (const album of albums) {
      const type = album.albumType || 'Other';
      const arr = groups.get(type) ?? [];
      arr.push(album);
      groups.set(type, arr);
    }
    const orderedKeys = [
      ...ALBUM_TYPE_ORDER.filter((t) => groups.has(t)),
      ...[...groups.keys()].filter((t) => !ALBUM_TYPE_ORDER.includes(t)).sort(),
    ];
    return orderedKeys.map((type) => ({
      type,
      albums: [...(groups.get(type) ?? [])].sort(
        (a, b) => new Date(b.releaseDate || 0).getTime() - new Date(a.releaseDate || 0).getTime()
      ),
    }));
  }, [albums]);

  if (loading) {
    return <><PageHeader className="-mx-2 md:-mx-6" title="Artist" /><PageSpinner /></>;
  }

  if (!artist) {
    return <div className="text-center py-12 text-muted-foreground">Artist not found</div>;
  }

  const poster = getImageUrl(artist.images, 'poster', 'lidarr');
  const fanart = getImageUrl(artist.images, 'fanart', 'lidarr');
  const qualityProfile = qualityProfiles.find((qp) => qp.id === artist.qualityProfileId);
  const metadataProfile = metadataProfiles.find((mp) => mp.id === artist.metadataProfileId);
  const artistTags = tags.filter((t) => artist.tags.includes(t.id));
  const stats = artist.statistics;
  const rating = artist.ratings?.value ?? 0;

  const infoRows: { label: string; value: string }[] = [
    { label: 'Status', value: artist.status ? artist.status.charAt(0).toUpperCase() + artist.status.slice(1) : 'Unknown' },
    ...(artist.artistType ? [{ label: 'Type', value: artist.artistType }] : []),
    ...(artist.disambiguation ? [{ label: 'Also known as', value: artist.disambiguation }] : []),
    { label: 'Quality Profile', value: qualityProfile?.name || 'Unknown' },
    { label: 'Metadata Profile', value: metadataProfile?.name || 'Unknown' },
    ...(stats ? [{ label: 'Albums', value: String(stats.albumCount) }] : []),
    ...(stats ? [{ label: 'Tracks', value: `${stats.trackFileCount} / ${stats.totalTrackCount} (${Math.round(stats.percentOfTracks)}%)` }] : []),
    ...(stats && stats.sizeOnDisk > 0 ? [{ label: 'Size on Disk', value: formatBytes(stats.sizeOnDisk) }] : []),
    ...(artistTags.length > 0 ? [{ label: 'Tags', value: artistTags.map((t) => t.label).join(', ') }] : []),
    ...(artist.path ? [{ label: 'Path', value: artist.path }] : []),
    ...(artist.added ? [{ label: 'Added', value: format(new Date(artist.added), 'MMM d, yyyy') }] : []),
  ];

  const complete = !!stats && stats.totalTrackCount > 0 && stats.trackFileCount >= stats.totalTrackCount;

  return (
    <>
      <PageHeader
        title={artist.artistName}
        className="-mx-2 md:-mx-6"
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
                ) : artist.monitored ? (
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
                  <DropdownMenuItem onClick={handleRefresh} disabled={!!actionLoading}>
                    <RefreshCw className="h-4 w-4" />
                    Refresh &amp; Scan
                  </DropdownMenuItem>
                )}
                {canManageActivity && (
                  <DropdownMenuItem onClick={handleSearch} disabled={!!actionLoading}>
                    <Search className="h-4 w-4" />
                    Search Monitored Albums
                  </DropdownMenuItem>
                )}
                {externalUrls.LIDARR && artist.foreignArtistId && (
                  <DropdownMenuItem asChild>
                    <a href={`${externalUrls.LIDARR}/artist/${artist.foreignArtistId}`} target="_blank" rel="noopener noreferrer">
                      <Disc3 className="h-4 w-4" />
                      Open in Lidarr
                    </a>
                  </DropdownMenuItem>
                )}
                {artist.foreignArtistId && (
                  <DropdownMenuItem
                    onClick={() => window.open(`https://musicbrainz.org/artist/${artist.foreignArtistId}`, '_blank')}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open in MusicBrainz
                  </DropdownMenuItem>
                )}
                {canEditArtist && (
                  <DropdownMenuItem onClick={() => router.push(`/music/${artist.id}/edit`)}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                )}
                {canManageActivity && (
                  <DropdownMenuItem onClick={() => setShowRenamePreview(true)}>
                    <FileEdit className="h-4 w-4" />
                    Preview Rename
                  </DropdownMenuItem>
                )}
                {canDeleteArtist && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setShowDelete(true)}>
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div ref={contentScrollRef} className="space-y-6 animate-content-in">
        {/* Hero */}
        {fanart ? (
          <div className="-mx-2 md:-mx-6">
            <div className="relative w-full h-[220px] overflow-hidden bg-muted/40">
              <Image
                src={fanart}
                alt=""
                fill
                sizes="100vw"
                className="object-cover"
                priority
                unoptimized={isProtectedApiImageSrc(fanart)}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
            </div>
            <div className="relative -mt-[90px] px-2 md:px-6 flex gap-3.5">
              <div className="w-[100px] shrink-0">
                <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted shadow-lg ring-1 ring-border/20">
                  {poster ? (
                    <Image src={poster} alt={artist.artistName} fill sizes="100px" className="object-cover" unoptimized={isProtectedApiImageSrc(poster)} />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground"><Disc3 className="h-8 w-8" /></div>
                  )}
                </div>
              </div>
              <div className="flex-1 min-w-0 pt-[60px]">
                <Badge
                  className={`mb-1.5 text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 ${complete ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}
                  variant="outline"
                >
                  {complete ? 'Complete' : 'Missing tracks'}
                </Badge>
                <h1 className="text-xl font-bold leading-tight line-clamp-2">{artist.artistName}</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {[artist.artistType, artist.status ? artist.status.charAt(0).toUpperCase() + artist.status.slice(1) : null].filter(Boolean).join(' · ')}
                </p>
                {rating > 0 && (
                  <div className="flex items-center gap-1 mt-2">
                    <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                    <span className="text-sm font-semibold">{rating.toFixed(1)}</span>
                    {artist.ratings?.votes ? <span className="text-[10px] text-muted-foreground">{artist.ratings.votes} votes</span> : null}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex gap-4">
            <div className="w-[120px] shrink-0">
              <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted">
                {poster ? (
                  <Image src={poster} alt={artist.artistName} fill sizes="120px" className="object-cover" unoptimized={isProtectedApiImageSrc(poster)} />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground"><Disc3 className="h-10 w-10" /></div>
                )}
              </div>
            </div>
            <div className="flex-1 min-w-0 pt-1">
              <Badge
                className={`mb-1.5 text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 ${complete ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}
                variant="outline"
              >
                {complete ? 'Complete' : 'Missing tracks'}
              </Badge>
              <h1 className="text-xl font-bold leading-tight line-clamp-2">{artist.artistName}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {[artist.artistType, artist.status ? artist.status.charAt(0).toUpperCase() + artist.status.slice(1) : null].filter(Boolean).join(' · ')}
              </p>
              {rating > 0 && (
                <div className="flex items-center gap-1 mt-2">
                  <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                  <span className="text-sm font-semibold">{rating.toFixed(1)}</span>
                  {artist.ratings?.votes ? <span className="text-[10px] text-muted-foreground">{artist.ratings.votes} votes</span> : null}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Genres */}
        {artist.genres?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {artist.genres.slice(0, 12).map((g) => (
              <Badge key={g} variant="secondary" className="text-[10px] px-1.5 py-0">{g}</Badge>
            ))}
          </div>
        )}

        {/* Overview / bio */}
        {artist.overview && (
          <div>
            <p className={`text-sm text-muted-foreground leading-relaxed ${!overviewExpanded ? 'line-clamp-3' : ''}`}>
              {artist.overview}
            </p>
            <button onClick={() => setOverviewExpanded(!overviewExpanded)} className="text-sm text-primary font-medium mt-1">
              {overviewExpanded ? 'less' : 'more...'}
            </button>
          </div>
        )}

        {/* Pill buttons */}
        {canManageActivity && (
          <Button onClick={handleSearch} disabled={!!actionLoading} className="w-full rounded-full h-10" variant="secondary">
            {actionLoading === 'search' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
            Search Monitored Albums
          </Button>
        )}
        <Button onClick={() => router.push(`/music/${artist.id}/files`)} className="w-full rounded-full h-10" variant="secondary">
          <FileText className="h-4 w-4 mr-2" />
          Files &amp; information
        </Button>

        {/* External links */}
        {linkChips.length > 0 && (
          <div>
            <h2 className="text-base font-semibold mb-2">Links</h2>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-2 px-2 md:-mx-6 md:px-6 scrollbar-hide">
              {linkChips.map((chip) => (
                <a
                  key={chip.label}
                  href={chip.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/50 bg-accent/30 text-xs font-medium hover:bg-accent transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  {chip.label}
                </a>
              ))}
            </div>
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

        {/* Discography */}
        <div className="space-y-5">
          <h2 className="text-base font-semibold">Discography</h2>
          {groupedAlbums.length === 0 ? (
            <p className="text-sm text-muted-foreground">No albums found for this artist.</p>
          ) : (
            groupedAlbums.map((group) => (
              <div key={group.type} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.type}{group.type.endsWith('s') ? '' : group.albums.length === 1 ? '' : 's'} · {group.albums.length}
                </h3>
                <div className="space-y-2">
                  {group.albums.map((album) => {
                    const cover = getImageUrl(album.images, 'cover', 'lidarr');
                    const year = albumYear(album);
                    const aStats = album.statistics;
                    const progress = aStats ? `${aStats.trackFileCount}/${aStats.totalTrackCount}` : '';
                    return (
                      <div key={album.id} className="flex gap-3 rounded-xl bg-card p-2.5 hover:bg-muted/30 transition-colors">
                        <Link href={`/music/album/${album.id}`} className="relative shrink-0 h-14 w-14 rounded-md overflow-hidden bg-muted">
                          {cover ? (
                            <Image src={cover} alt={album.title} fill sizes="56px" className="object-cover" unoptimized={isProtectedApiImageSrc(cover)} />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground"><Disc3 className="h-5 w-5" /></div>
                          )}
                          {album.monitored === false && <div className="absolute inset-0 bg-background/40" />}
                        </Link>
                        <Link href={`/music/album/${album.id}`} className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{album.title}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            {year && <span className="text-xs text-muted-foreground">{year}</span>}
                            {album.secondaryTypes?.slice(0, 2).map((st) => (
                              <Badge key={st} variant="outline" className="text-[10px] px-1.5 py-0">{st}</Badge>
                            ))}
                            {progress && <span className="text-[10px] text-muted-foreground">{progress} tracks</span>}
                            {aStats && aStats.sizeOnDisk > 0 && <span className="text-[10px] text-muted-foreground">{formatBytes(aStats.sizeOnDisk)}</span>}
                            {album.ratings?.value ? (
                              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                <Star className="h-2.5 w-2.5 text-yellow-500 fill-yellow-500" />{album.ratings.value.toFixed(1)}
                              </span>
                            ) : null}
                          </div>
                        </Link>
                        {canEditMonitoring && (
                          <button
                            onClick={() => handleToggleAlbumMonitored(album)}
                            disabled={albumMonitorPending === album.id}
                            className="shrink-0 self-center min-w-[36px] min-h-[36px] flex items-center justify-center text-muted-foreground hover:text-foreground"
                            aria-label={album.monitored ? 'Unmonitor album' : 'Monitor album'}
                          >
                            {albumMonitorPending === album.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : album.monitored ? (
                              <Eye className="h-4 w-4 text-primary" />
                            ) : (
                              <EyeOff className="h-4 w-4" />
                            )}
                          </button>
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

      <RenamePreviewDialog
        open={showRenamePreview}
        onOpenChange={setShowRenamePreview}
        service="lidarr"
        mediaId={artist.id}
        mediaTitle={artist.artistName}
      />

      <Drawer open={showDelete} onOpenChange={setShowDelete}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Delete {artist.artistName}?</DrawerTitle>
            <DrawerDescription>
              This removes the artist from Lidarr. Optionally delete the files on disk too. This action cannot be undone.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={deleteFiles}
                onChange={(e) => setDeleteFiles(e.target.checked)}
                className="h-4 w-4 accent-destructive"
              />
              Also delete all files from disk
            </label>
          </div>
          <DrawerFooter>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="w-full">
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete Artist
            </Button>
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}
