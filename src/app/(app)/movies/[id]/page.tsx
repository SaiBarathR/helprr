'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';
import { InteractiveSearchDialog } from '@/components/media/interactive-search-dialog';
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
  Film,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { getImageUrl } from '@/components/media/media-card';
import { format } from 'date-fns';
import type { RadarrMovie, QualityProfile, Tag } from '@/types';
import {
  getMovieDetailSnapshot,
  setMovieDetailSnapshot,
} from '@/lib/movie-route-cache';

export default function MovieDetailPage() {
  const { id } = useParams();
  const movieId = Number(id);
  const router = useRouter();
  const [movie, setMovie] = useState<RadarrMovie | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [interactiveSearch, setInteractiveSearch] = useState(false);

  // Reference data
  const [qualityProfiles, setQualityProfiles] = useState<QualityProfile[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  const persistMovieSnapshot = useCallback((next: {
    movie?: RadarrMovie | null;
    qualityProfiles?: QualityProfile[];
    tags?: Tag[];
  } = {}) => {
    if (!Number.isFinite(movieId)) return;
    setMovieDetailSnapshot(movieId, {
      movie: next.movie ?? movie,
      qualityProfiles: next.qualityProfiles ?? qualityProfiles,
      tags: next.tags ?? tags,
    });
  }, [movie, movieId, qualityProfiles, tags]);

  const loadData = useCallback(async (hasCachedData: boolean) => {
    if (!Number.isFinite(movieId)) {
      setLoading(false);
      return;
    }

    // Keep movie detail page instant when returning from sub-pages.
    if (hasCachedData) {
      setLoading(false);
    }

    try {
      const [movieResult, nextQualityProfiles, nextTags] = await Promise.all([
        fetch(`/api/radarr/${movieId}`).then(async (response): Promise<{ movie: RadarrMovie | null; notFound: boolean }> => {
          if (response.ok) {
            return { movie: await response.json() as RadarrMovie, notFound: false };
          }

          let message = '';
          try {
            const payload = await response.json() as { error?: string };
            message = payload.error ?? '';
          } catch {
            // Ignore invalid error payloads.
          }

          const notFound = response.status === 404 || /not found|does not exist/i.test(message);
          if (notFound) {
            return { movie: null, notFound: true };
          }

          throw new Error(message || `Failed to fetch movie (${response.status})`);
        }),
        fetch('/api/radarr/qualityprofiles').then(async (r): Promise<QualityProfile[]> => (r.ok ? await r.json() as QualityProfile[] : [])),
        fetch('/api/radarr/tags').then(async (r): Promise<Tag[]> => (r.ok ? await r.json() as Tag[] : [])),
      ]);

      const nextMovie = movieResult.movie;
      setMovie(nextMovie);
      setQualityProfiles(nextQualityProfiles);
      setTags(nextTags);
      setMovieDetailSnapshot(movieId, {
        movie: nextMovie,
        qualityProfiles: nextQualityProfiles,
        tags: nextTags,
      });

      if (movieResult.notFound) {
        return;
      }
    } catch {
      if (!hasCachedData) {
        setMovie(null);
        setQualityProfiles([]);
        setTags([]);
      }
    } finally {
      setLoading(false);
    }
  }, [movieId]);

  useEffect(() => {
    const cached = Number.isFinite(movieId) ? getMovieDetailSnapshot(movieId) : null;

    if (cached) {
      setMovie(cached.movie);
      setQualityProfiles(cached.qualityProfiles);
      setTags(cached.tags);
      setLoading(false);
    } else {
      setLoading(true);
    }

    void loadData(Boolean(cached));
  }, [loadData, movieId]);


  async function handleSearch() {
    if (!movie) return;
    setActionLoading('search');
    try {
      await fetch('/api/radarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'MoviesSearch', movieIds: [movie.id] }),
      });
      toast.success('Search started');
    } catch { toast.error('Search failed'); }
    finally { setActionLoading(''); }
  }

  async function handleRefresh() {
    if (!movie) return;
    setActionLoading('refresh');
    try {
      await fetch('/api/radarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'RefreshMovie', movieId: movie.id }),
      });
      toast.success('Refresh started');
    } catch { toast.error('Refresh failed'); }
    finally { setActionLoading(''); }
  }

  async function handleToggleMonitored() {
    if (!movie) return;
    setActionLoading('monitor');
    try {
      const res = await fetch(`/api/radarr/${movie.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...movie, monitored: !movie.monitored }),
      });
      if (res.ok) {
        const updated = await res.json();
        setMovie(updated);
        persistMovieSnapshot({ movie: updated });
        toast.success(updated.monitored ? 'Now monitored' : 'Unmonitored');
      }
    } catch { toast.error('Failed to update'); }
    finally { setActionLoading(''); }
  }

  async function handleDelete() {
    if (!movie) return;
    setDeleting(true);
    try {
      await fetch(`/api/radarr/${movie.id}?deleteFiles=true`, { method: 'DELETE' });
      toast.success('Movie deleted');
      router.push('/movies');
    } catch { toast.error('Delete failed'); }
    finally { setDeleting(false); }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-11 w-full" />
        <div className="flex gap-4 px-4">
          <Skeleton className="h-[180px] w-[120px] rounded-lg shrink-0" />
          <div className="flex-1 space-y-2 pt-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        <div className="px-4 space-y-3">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-full" />
        </div>
      </div>
    );
  }

  if (!movie) {
    return <div className="text-center py-12 text-muted-foreground">Movie not found</div>;
  }

  const poster = getImageUrl(movie.images, 'poster');
  const qualityProfile = qualityProfiles.find((qp) => qp.id === movie.qualityProfileId);
  const movieTags = tags.filter((t) => movie.tags.includes(t.id));
  const rootFolder = movie.path ? movie.path.split('/').slice(0, -1).join('/') : '';

  // Extract media info from movie file if available
  const mediaInfo = movie.movieFile as (RadarrMovie['movieFile'] & {
    mediaInfo?: {
      videoCodec?: string;
      audioCodec?: string;
      audioChannels?: number;
      subtitles?: string;
      videoDynamicRange?: string;
      resolution?: string;
    };
  }) | undefined;

  const metadataRows: { label: string; value: string }[] = [];

  metadataRows.push({
    label: 'STATUS',
    value: movie.status.charAt(0).toUpperCase() + movie.status.slice(1),
  });

  if (movie.studio) {
    metadataRows.push({ label: 'STUDIO', value: movie.studio });
  }

  if (movie.genres?.length) {
    metadataRows.push({ label: 'GENRE', value: movie.genres.join(', ') });
  }

  if (mediaInfo?.mediaInfo?.videoCodec) {
    const vidParts = [mediaInfo.mediaInfo.videoCodec];
    if (mediaInfo.mediaInfo.resolution) vidParts.push(mediaInfo.mediaInfo.resolution);
    if (mediaInfo.mediaInfo.videoDynamicRange) vidParts.push(mediaInfo.mediaInfo.videoDynamicRange);
    metadataRows.push({ label: 'VIDEO', value: vidParts.join(' - ') });
  }

  if (mediaInfo?.mediaInfo?.audioCodec) {
    const audioParts = [mediaInfo.mediaInfo.audioCodec];
    if (mediaInfo.mediaInfo.audioChannels) audioParts.push(`${mediaInfo.mediaInfo.audioChannels}ch`);
    metadataRows.push({ label: 'AUDIO', value: audioParts.join(' ') });
  }

  if (mediaInfo?.mediaInfo?.subtitles) {
    metadataRows.push({ label: 'SUBTITLES', value: mediaInfo.mediaInfo.subtitles });
  }

  const infoRows: { label: string; value: string }[] = [
    { label: 'Quality Profile', value: qualityProfile?.name || 'Unknown' },
    {
      label: 'Min. Availability',
      value: movie.minimumAvailability.charAt(0).toUpperCase() + movie.minimumAvailability.slice(1),
    },
    ...(movieTags.length > 0
      ? [{ label: 'Tags', value: movieTags.map((t) => t.label).join(', ') }]
      : []),
    ...(rootFolder ? [{ label: 'Root Folder', value: rootFolder }] : []),
    ...(movie.inCinemas
      ? [{ label: 'In Cinemas', value: format(new Date(movie.inCinemas), 'MMM d, yyyy') }]
      : []),
    ...(movie.digitalRelease
      ? [{ label: 'Digital Release', value: format(new Date(movie.digitalRelease), 'MMM d, yyyy') }]
      : []),
    ...(movie.physicalRelease
      ? [{ label: 'Physical Release', value: format(new Date(movie.physicalRelease), 'MMM d, yyyy') }]
      : []),
    {
      label: 'Added',
      value: movie.added ? format(new Date(movie.added), 'MMM d, yyyy') : 'Unknown',
    },
  ];

  return (
    <>
      {/* Header */}
      <PageHeader
        title={movie.title}
        rightContent={
          <>
            {/* Bookmark / Monitored toggle */}
            <button
              onClick={handleToggleMonitored}
              disabled={actionLoading === 'monitor'}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary"
            >
              {actionLoading === 'monitor' ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : movie.monitored ? (
                <BookmarkCheck className="h-5 w-5 fill-primary" />
              ) : (
                <Bookmark className="h-5 w-5" />
              )}
            </button>

            {/* 3-dot menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary">
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={handleRefresh}
                  disabled={!!actionLoading}
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleSearch}
                  disabled={!!actionLoading}
                >
                  <Search className="h-4 w-4" />
                  Automatic Search
                </DropdownMenuItem>
                {movie.imdbId && (
                  <DropdownMenuItem
                    onClick={() => window.open(`https://www.imdb.com/title/${movie.imdbId}`, '_blank')}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open in IMDb
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => router.push(`/movies/${movie.id}/edit`)}
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setShowDelete(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="space-y-6 px-0">
        {/* Hero: Poster + Title block */}
        <div className="flex gap-4 px-4">
          {/* Poster */}
          <div className="w-[120px] shrink-0">
            <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted">
              {poster ? (
                <Image
                  src={poster}
                  alt={movie.title}
                  fill
                  sizes="120px"
                  className="object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                  <Film className="h-10 w-10" />
                </div>
              )}
            </div>
          </div>

          {/* Title area */}
          <div className="flex-1 min-w-0 pt-1">
            {/* Status badge */}
            <Badge
              className={`mb-1.5 text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 ${
                movie.hasFile
                  ? 'bg-green-500/20 text-green-400 border-green-500/30'
                  : 'bg-red-500/20 text-red-400 border-red-500/30'
              }`}
              variant="outline"
            >
              {movie.hasFile ? 'Downloaded' : 'Missing'}
            </Badge>

            {/* Title */}
            <h1 className="text-xl font-bold leading-tight line-clamp-2">{movie.title}</h1>

            {/* Year, runtime, certification */}
            <p className="text-sm text-muted-foreground mt-1">
              {[
                movie.year,
                movie.runtime > 0 ? `${movie.runtime} min` : null,
                movie.certification || null,
              ]
                .filter(Boolean)
                .join(' \u00B7 ')}
            </p>

            {/* Ratings row */}
            {(movie.ratings?.imdb || movie.ratings?.tmdb) && (
              <div className="flex items-center gap-3 mt-2">
                {movie.ratings.imdb && movie.ratings.imdb.value > 0 && (
                  <div className="flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />
                    <span className="text-sm font-semibold">{movie.ratings.imdb.value.toFixed(1)}</span>
                    <span className="text-[10px] text-muted-foreground">IMDb</span>
                  </div>
                )}
                {movie.ratings.tmdb && movie.ratings.tmdb.value > 0 && (
                  <div className="flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 text-blue-500 fill-blue-500" />
                    <span className="text-sm font-semibold">{(movie.ratings.tmdb.value * 10).toFixed(0)}%</span>
                    <span className="text-[10px] text-muted-foreground">TMDb</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Metadata rows - borderless key-value */}
        {metadataRows.length > 0 && (
          <div className="px-4">
            {metadataRows.map((row) => (
              <div
                key={row.label}
                className="flex justify-between items-start py-2.5 border-b border-border/40 last:border-b-0"
              >
                <span className="text-xs font-medium text-muted-foreground tracking-wide uppercase shrink-0">
                  {row.label}
                </span>
                <span className="text-sm text-right ml-4 truncate">{row.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Overview - collapsible */}
        {movie.overview && (
          <div className="px-4">
            <div className="relative">
              <p
                className={`text-sm text-muted-foreground leading-relaxed ${
                  !overviewExpanded ? 'line-clamp-3' : ''
                }`}
              >
                {movie.overview}
              </p>
              <button
                onClick={() => setOverviewExpanded(!overviewExpanded)}
                className="text-sm text-primary font-medium mt-1"
              >
                {overviewExpanded ? 'less' : 'more...'}
              </button>
            </div>
          </div>
        )}

        {/* Pill buttons */}
        <div className="flex gap-3 px-4">
          <Button
            onClick={handleSearch}
            disabled={!!actionLoading}
            className="flex-1 rounded-full h-10"
            variant="secondary"
          >
            {actionLoading === 'search' ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Search className="h-4 w-4 mr-2" />
            )}
            Automatic
          </Button>
          <Button
            onClick={() => setInteractiveSearch(true)}
            className="flex-1 rounded-full h-10"
            variant="secondary"
          >
            <Search className="h-4 w-4 mr-2" />
            Interactive
          </Button>
        </div>
        <div className="px-4">
          <Button
            onClick={() => router.push(`/movies/${movie.id}/files`)}
            className="w-full rounded-full h-10"
            variant="secondary"
          >
            <FileText className="h-4 w-4 mr-2" />
            Files &amp; information
          </Button>
        </div>

        {/* Information section */}
        <div className="px-4">
          <h2 className="text-base font-semibold mb-2">Information</h2>
          <div>
            {infoRows.map((row) => (
              <div
                key={row.label}
                className="flex justify-between items-start py-2.5 border-b border-border/40 last:border-b-0"
              >
                <span className="text-sm text-muted-foreground shrink-0">{row.label}</span>
                <span className="text-sm text-right ml-4 truncate max-w-[60%]">{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="pb-8" />

      </div>

      {/* Interactive Search */}
      <InteractiveSearchDialog
        open={interactiveSearch}
        onOpenChange={setInteractiveSearch}
        title={movie.title}
        service="radarr"
        searchParams={{ movieId: movie.id }}
      />

      {/* Delete Drawer (bottom sheet) */}
      <Drawer open={showDelete} onOpenChange={setShowDelete}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Delete {movie.title}?</DrawerTitle>
            <DrawerDescription>
              This will remove the movie from Radarr and delete all files from disk. This action
              cannot be undone.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              className="w-full"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete Movie
            </Button>
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">
                Cancel
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}
