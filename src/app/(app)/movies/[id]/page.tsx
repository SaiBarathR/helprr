'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/page-spinner';
import { PageHeader } from '@/components/layout/page-header';
import { VirtualizedPersonRail } from '@/components/media/virtualized-person-rail';
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
import type { RadarrMovie, RadarrCredit, QualityProfile, Tag, DiscoverMovieFullDetail } from '@/types';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { crewRolePriority } from '@/lib/crew-priority';
import {
  getMovieDetailSnapshot,
  setMovieDetailSnapshot,
} from '@/lib/movie-route-cache';
import { useExternalUrls } from '@/lib/hooks/use-external-urls';
import Link from 'next/link';
import { DiscoverVideoRail } from '@/components/discover/discover-video-rail';
import { DiscoverMediaRail } from '@/components/discover/discover-media-rail';
import { DiscoverWatchProvidersSection } from '@/components/discover/discover-watch-providers';

type RatingItem = {
  label: string;
  score: string;
  votes: number;
  color: string;
};

function formatRatingVotes(votes: number): string {
  if (!votes) return '';
  if (votes >= 1_000_000) return `${(votes / 1_000_000).toFixed(1)}M`;
  if (votes >= 1_000) return `${(votes / 1_000).toFixed(votes >= 10_000 ? 0 : 1)}K`;
  return String(votes);
}

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
  const externalUrls = useExternalUrls();
  const [jellyfinLoading, setJellyfinLoading] = useState(false);
  const [tmdbData, setTmdbData] = useState<DiscoverMovieFullDetail | null>(null);

  // Reference data
  const [qualityProfiles, setQualityProfiles] = useState<QualityProfile[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [credits, setCredits] = useState<RadarrCredit[]>([]);
  const creditsRequestIdRef = useRef(0);

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
    setCredits([]);
    const creditsRequestId = ++creditsRequestIdRef.current;

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

      // Fetch credits in background (non-blocking)
      void fetch(`/api/radarr/credit?movieId=${movieId}`)
        .then(async (r) => (r.ok ? (await r.json()) as RadarrCredit[] : []))
        .then((nextCredits) => {
          if (creditsRequestId !== creditsRequestIdRef.current) return;
          setCredits(nextCredits);
        })
        .catch(() => {
          if (creditsRequestId !== creditsRequestIdRef.current) return;
          setCredits([]);
        });
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

  // Background-fetch TMDB enrichment data
  useEffect(() => {
    if (!movie?.tmdbId) {
      setTmdbData(null);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/discover/movie/${movie.tmdbId}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DiscoverMovieFullDetail | null) => setTmdbData(data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setTmdbData(null);
      });
    return () => controller.abort();
  }, [movie?.tmdbId]);

  async function handleOpenInJellyfin() {
    if (!movie || !externalUrls.JELLYFIN) return;
    const popup = window.open('', '_blank');
    if (!popup) {
      toast.error('Popup blocked');
      return;
    }

    setJellyfinLoading(true);
    try {
      const params = new URLSearchParams();
      if (movie.imdbId) params.set('imdbId', movie.imdbId);
      if (movie.tmdbId) params.set('tmdbId', String(movie.tmdbId));
      if (!params.toString()) {
        popup.close();
        toast.error('No provider IDs available');
        return;
      }
      const res = await fetch(`/api/jellyfin/lookup?${params}`);
      const data = res.ok ? await res.json() : null;
      if (data?.itemId) {
        popup.location.href = `${externalUrls.JELLYFIN}/web/index.html#!/details?id=${data.itemId}`;
      } else {
        popup.close();
        toast.error('Not found in Jellyfin');
      }
    } catch {
      popup.close();
      toast.error('Jellyfin lookup failed');
    } finally {
      setJellyfinLoading(false);
    }
  }

  const ratingItems = useMemo<RatingItem[]>(() => {
    const ratings = movie?.ratings;
    if (!ratings) return [];

    const items: RatingItem[] = [];
    if (ratings.imdb && ratings.imdb.value > 0) items.push({ label: 'IMDb', score: ratings.imdb.value.toFixed(1), votes: ratings.imdb.votes, color: 'text-yellow-500 fill-yellow-500' });
    if (ratings.tmdb && ratings.tmdb.value > 0) items.push({ label: 'TMDb', score: ratings.tmdb.value.toFixed(1), votes: ratings.tmdb.votes, color: 'text-sky-500 fill-sky-500' });
    if (ratings.metacritic && ratings.metacritic.value > 0) items.push({ label: 'MC', score: String(Math.round(ratings.metacritic.value)), votes: ratings.metacritic.votes, color: 'text-emerald-500 fill-emerald-500' });
    if (ratings.rottenTomatoes && ratings.rottenTomatoes.value > 0) items.push({ label: 'RT', score: `${Math.round(ratings.rottenTomatoes.value)}%`, votes: ratings.rottenTomatoes.votes, color: 'text-red-500 fill-red-500' });
    if (ratings.trakt && ratings.trakt.value > 0) items.push({ label: 'Trakt', score: ratings.trakt.value.toFixed(1), votes: ratings.trakt.votes, color: 'text-purple-500 fill-purple-500' });
    return items;
  }, [movie?.ratings]);


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
    return <><PageHeader title="Movie" /><PageSpinner /></>;
  }

  if (!movie) {
    return <div className="text-center py-12 text-muted-foreground">Movie not found</div>;
  }

  const poster = getImageUrl(movie.images, 'poster', 'radarr');
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
                {externalUrls.RADARR && movie.tmdbId && (
                  <DropdownMenuItem asChild>
                    <a href={`${externalUrls.RADARR}/movie/${movie.tmdbId}`} target="_blank" rel="noopener noreferrer">
                      <Film className="h-4 w-4" />
                      Open in Radarr
                    </a>
                  </DropdownMenuItem>
                )}
                {externalUrls.JELLYFIN && (movie?.imdbId || movie?.tmdbId) && (
                  <DropdownMenuItem onClick={handleOpenInJellyfin} disabled={jellyfinLoading}>
                    {jellyfinLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                    Open in Jellyfin
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

      <div className="space-y-7 animate-content-in">
        {/* Hero: Backdrop or flat poster layout */}
        {tmdbData?.backdropPath ? (
          <div className="relative">
            {/* Backdrop */}
            <div className="relative w-full h-[260px] sm:h-[340px] lg:h-[420px] overflow-hidden bg-[color:var(--ink-deep)] -mx-3 md:-mx-8">
              <Image
                src={toCachedImageSrc(tmdbData.backdropPath, 'tmdb') || tmdbData.backdropPath}
                alt=""
                fill
                sizes="100vw"
                className="object-cover animate-hero-zoom"
                priority
                unoptimized
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/75 to-background/15" />
              <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-background/40" />
              <div aria-hidden className="cinema-grain" />
              {/* Marquee strip on backdrop */}
              <div className="absolute top-3 left-3 md:left-8 right-3 md:right-8 flex items-center gap-2">
                <span className="marquee-dot" aria-hidden />
                <span className="tracked-caps text-[9.5px] text-[color:var(--amber)]/90">
                  {movie.hasFile ? 'In Library \u00B7 On Disk' : movie.monitored ? 'Monitored \u00B7 Awaiting' : 'Idle'}
                </span>
                <span className="hairline flex-1" aria-hidden />
                <span className="tracked-caps text-[9.5px] text-white/70 font-mono tabular hidden sm:inline" style={{ letterSpacing: '0.22em' }}>
                  Feature \u00B7 Film
                </span>
              </div>
            </div>

            {/* Poster + info overlapping */}
            <div className="relative -mt-[120px] sm:-mt-[150px] lg:-mt-[180px] px-3 md:px-8 flex gap-4 sm:gap-5">
              <div className="w-[120px] sm:w-[150px] lg:w-[180px] shrink-0">
                <div
                  className="relative aspect-[2/3] overflow-hidden bg-muted/60"
                  style={{
                    borderRadius: 'calc(var(--radius) - 1px)',
                    boxShadow: '0 24px 48px -16px rgba(0,0,0,0.65), 0 0 0 1px var(--hairline)',
                  }}
                >
                  {poster ? (
                    <Image
                      src={poster}
                      alt={movie.title}
                      fill
                      sizes="(max-width: 640px) 120px, 180px"
                      className="object-cover"
                      unoptimized={isProtectedApiImageSrc(poster)}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                      <Film className="h-9 w-9" />
                    </div>
                  )}
                </div>
              </div>
              <div className="flex-1 min-w-0 pt-[60px] sm:pt-[80px] lg:pt-[100px]">
                <div className="inline-flex items-center gap-1.5 mb-2 px-2 py-0.5 border tracked-caps text-[9px]"
                  style={{
                    borderRadius: '3px',
                    letterSpacing: '0.22em',
                    background: movie.hasFile ? 'oklch(0.78 0.13 162 / 0.16)' : 'oklch(0.66 0.20 25 / 0.16)',
                    borderColor: movie.hasFile ? 'oklch(0.78 0.13 162 / 0.4)' : 'oklch(0.66 0.20 25 / 0.4)',
                    color: movie.hasFile ? 'oklch(0.78 0.13 162)' : 'oklch(0.78 0.18 25)',
                  }}
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: movie.hasFile ? 'oklch(0.78 0.13 162)' : 'oklch(0.66 0.20 25)' }}
                  />
                  {movie.hasFile ? 'Downloaded' : 'Missing'}
                </div>
                <h1 className="font-display text-[26px] sm:text-[34px] lg:text-[44px] leading-[1.02] tracking-[-0.025em] line-clamp-3 hero-title-rise">
                  {movie.title}
                </h1>
                <p className="font-mono tabular tracked-mid text-[10.5px] text-muted-foreground/80 mt-2 hero-meta-fade" style={{ letterSpacing: '0.16em' }}>
                  {[
                    movie.year,
                    movie.runtime > 0 ? `${movie.runtime} MIN` : null,
                    movie.certification || null,
                  ]
                    .filter(Boolean)
                    .join('  \u00B7  ')}
                </p>
                {ratingItems.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3 hero-meta-fade">
                    {ratingItems.map((ri) => (
                      <div key={ri.label} className="flex items-center gap-1">
                        <Star className={`h-3 w-3 ${ri.color}`} />
                        <span className="font-mono tabular text-[13px] font-semibold">{ri.score}</span>
                        <span className="tracked-caps text-[8.5px] text-muted-foreground/80" style={{ letterSpacing: '0.18em' }}>
                          {ri.label}
                        </span>
                        {ri.votes > 0 && (
                          <span className="font-mono tabular text-[9px] text-muted-foreground/55">
                            {formatRatingVotes(ri.votes)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {tmdbData.tagline && (
              <div className="mt-4 flex items-start gap-3 px-1">
                <span className="font-display text-[28px] leading-none text-[color:var(--amber)]/70">&ldquo;</span>
                <p className="font-display italic text-[15px] sm:text-[17px] leading-snug text-muted-foreground/95 pt-1">
                  {tmdbData.tagline}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex gap-4">
            <div className="w-[120px] sm:w-[140px] shrink-0">
              <div
                className="relative aspect-[2/3] overflow-hidden bg-muted/60"
                style={{ borderRadius: 'calc(var(--radius) - 1px)', boxShadow: '0 0 0 1px var(--hairline)' }}
              >
                {poster ? (
                  <Image
                    src={poster}
                    alt={movie.title}
                    fill
                    sizes="140px"
                    className="object-cover"
                    unoptimized={isProtectedApiImageSrc(poster)}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    <Film className="h-10 w-10" />
                  </div>
                )}
              </div>
            </div>
            <div className="flex-1 min-w-0 pt-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="marquee-dot" aria-hidden />
                <span className="tracked-caps text-[9px] text-[color:var(--amber)]/85" style={{ letterSpacing: '0.22em' }}>
                  Feature \u00B7 Film
                </span>
              </div>
              <div className="inline-flex items-center gap-1.5 mb-2 px-2 py-0.5 border tracked-caps text-[9px]"
                style={{
                  borderRadius: '3px',
                  letterSpacing: '0.22em',
                  background: movie.hasFile ? 'oklch(0.78 0.13 162 / 0.16)' : 'oklch(0.66 0.20 25 / 0.16)',
                  borderColor: movie.hasFile ? 'oklch(0.78 0.13 162 / 0.4)' : 'oklch(0.66 0.20 25 / 0.4)',
                  color: movie.hasFile ? 'oklch(0.78 0.13 162)' : 'oklch(0.78 0.18 25)',
                }}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: movie.hasFile ? 'oklch(0.78 0.13 162)' : 'oklch(0.66 0.20 25)' }}
                />
                {movie.hasFile ? 'Downloaded' : 'Missing'}
              </div>
              <h1 className="font-display text-[24px] sm:text-[28px] leading-[1.04] tracking-[-0.022em] line-clamp-3">{movie.title}</h1>
              <p className="font-mono tabular tracked-mid text-[10.5px] text-muted-foreground/80 mt-2" style={{ letterSpacing: '0.16em' }}>
                {[
                  movie.year,
                  movie.runtime > 0 ? `${movie.runtime} MIN` : null,
                  movie.certification || null,
                ]
                  .filter(Boolean)
                  .join('  \u00B7  ')}
              </p>
              {ratingItems.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3">
                  {ratingItems.map((ri) => (
                    <div key={ri.label} className="flex items-center gap-1">
                      <Star className={`h-3 w-3 ${ri.color}`} />
                      <span className="font-mono tabular text-[13px] font-semibold">{ri.score}</span>
                      <span className="tracked-caps text-[8.5px] text-muted-foreground/80" style={{ letterSpacing: '0.18em' }}>
                        {ri.label}
                      </span>
                      {ri.votes > 0 && (
                        <span className="font-mono tabular text-[9px] text-muted-foreground/55">
                          {formatRatingVotes(ri.votes)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Metadata rows */}
        {metadataRows.length > 0 && (
          <div className="border-t border-b border-[color:var(--hairline)] py-1">
            {metadataRows.map((row) => (
              <div
                key={row.label}
                className="flex justify-between items-baseline gap-3 py-2.5 border-b border-[color:var(--hairline)] last:border-b-0"
              >
                <span className="tracked-caps text-[9px] text-muted-foreground shrink-0" style={{ letterSpacing: '0.24em' }}>
                  {row.label}
                </span>
                <span className="text-[13px] text-right truncate font-mono tabular text-foreground/95" style={{ letterSpacing: '0.01em' }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Overview */}
        {movie.overview && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="reel" aria-hidden />
              <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
                Synopsis
              </h2>
              <span className="hairline flex-1" aria-hidden />
            </div>
            <div className="relative pl-1">
              <p
                className={`text-[14px] text-foreground/85 leading-relaxed ${
                  !overviewExpanded ? 'line-clamp-3' : ''
                }`}
              >
                {movie.overview}
              </p>
              <button
                onClick={() => setOverviewExpanded(!overviewExpanded)}
                className="press-feedback tracked-caps text-[9.5px] text-[color:var(--amber)] mt-2 hover:underline"
              >
                {overviewExpanded ? '\u2014 Show less' : '\u2014 Read more'}
              </button>
            </div>
          </div>
        )}

        {/* Cast & Crew */}
        {credits.length > 0 && <MovieCreditsSection credits={credits} movieId={movieId} />}

        {/* Action buttons */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="reel" aria-hidden />
            <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
              Operate \u00B7 Booth
            </h2>
            <span className="hairline flex-1" aria-hidden />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleSearch}
              disabled={!!actionLoading}
              className="flex-1 h-11 cta-sheen projector-glow"
            >
              {actionLoading === 'search' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              <span className="tracked-caps text-[10px]">Auto Search</span>
            </Button>
            <Button
              onClick={() => setInteractiveSearch(true)}
              className="flex-1 h-11"
              variant="outline"
            >
              <Search className="h-4 w-4" />
              <span className="tracked-caps text-[10px]">Interactive</span>
            </Button>
          </div>
          <Button
            onClick={() => router.push(`/movies/${movie.id}/files`)}
            className="w-full h-11"
            variant="outline"
          >
            <FileText className="h-4 w-4" />
            <span className="tracked-caps text-[10px]">Files &amp; Media Info</span>
          </Button>
        </div>

        {/* Information section */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="reel" aria-hidden />
            <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
              Booth Sheet
            </h2>
            <span className="hairline flex-1" aria-hidden />
          </div>
          <div className="border-t border-b border-[color:var(--hairline)] py-1">
            {infoRows.map((row) => (
              <div
                key={row.label}
                className="flex justify-between items-baseline gap-3 py-2.5 border-b border-[color:var(--hairline)] last:border-b-0"
              >
                <span className="text-[12px] text-muted-foreground/85 shrink-0">{row.label}</span>
                <span className="text-[13px] text-right truncate max-w-[60%] font-mono tabular">{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* TMDB Enrichment Sections */}
        {tmdbData && (
          <>
            {tmdbData.videos.length > 0 && (
              <DiscoverVideoRail title="Videos" videos={tmdbData.videos} />
            )}

            {tmdbData.recommendations.length > 0 && (
              <DiscoverMediaRail title="Recommendations" items={tmdbData.recommendations} />
            )}

            {tmdbData.similar.length > 0 && (
              <DiscoverMediaRail title="Similar Films" items={tmdbData.similar} />
            )}

            {tmdbData.watchProviders && (
              <DiscoverWatchProvidersSection providers={tmdbData.watchProviders} />
            )}

            {tmdbData.productionCompanies.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="reel" aria-hidden />
                  <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
                    Production
                  </h2>
                  <span className="hairline flex-1" aria-hidden />
                </div>
                <div className="flex flex-wrap gap-2">
                  {tmdbData.productionCompanies.map((company) => {
                    const logoSrc = company.logoPath
                      ? toCachedImageSrc(
                          company.logoPath.startsWith('http') ? company.logoPath : `https://image.tmdb.org/t/p/w185${company.logoPath}`,
                          'tmdb'
                        )
                      : null;
                    return (
                      <Link
                        key={company.id}
                        href={`/discover?companies=${company.id}&contentType=movie`}
                        className="press-feedback flex items-center gap-2 px-2.5 py-1.5 border border-[color:var(--hairline)] bg-card/40 hover:border-[color:var(--amber-soft)] hover:bg-card/70 transition-colors"
                        style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
                      >
                        {logoSrc && (
                          <div className="relative h-5 w-8">
                            <Image
                              src={logoSrc}
                              alt={company.name}
                              fill
                              sizes="32px"
                              className="object-contain"
                              unoptimized={isProtectedApiImageSrc(logoSrc)}
                            />
                          </div>
                        )}
                        <span className="text-[11.5px] font-medium">{company.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {tmdbData.collection && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="reel" aria-hidden />
                  <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
                    Collection
                  </h2>
                  <span className="hairline flex-1" aria-hidden />
                </div>
                <Link
                  href={`/discover/collection/${tmdbData.collection.id}`}
                  className="group press-feedback flex items-center gap-3 p-3 bg-card/40 border border-[color:var(--hairline)] hover:border-[color:var(--amber-soft)] hover:bg-card/70 transition-colors"
                  style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
                >
                  {tmdbData.collection.posterPath && (
                    <div
                      className="relative w-12 h-[72px] overflow-hidden shrink-0"
                      style={{ borderRadius: 'calc(var(--radius) - 3px)', boxShadow: '0 0 0 1px var(--hairline)' }}
                    >
                      <Image
                        src={toCachedImageSrc(tmdbData.collection.posterPath, 'tmdb') || tmdbData.collection.posterPath}
                        alt=""
                        fill
                        sizes="48px"
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="tracked-caps text-[8.5px] text-muted-foreground/80" style={{ letterSpacing: '0.22em' }}>
                      Part of saga
                    </p>
                    <p className="font-display text-[15px] line-clamp-1 mt-0.5 group-hover:text-[color:var(--amber)] transition-colors">
                      {tmdbData.collection.name}
                    </p>
                  </div>
                </Link>
              </div>
            )}
          </>
        )}

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

function MovieCreditsSection({ credits, movieId }: { credits: RadarrCredit[]; movieId: number }) {
  const { cast, crew } = useMemo(() => {
    const castItems = credits
      .filter((c) => c.type === 'cast')
      .sort((a, b) => a.order - b.order)
      .map((person) => ({
        id: person.personTmdbId,
        name: person.personName,
        imagePath: person.images.find((img) => img.coverType === 'headshot')?.remoteUrl ?? null,
        subtitle: person.character,
        keySuffix: `cast-${person.id}-${person.character || ''}`,
      }));

    const seenCrew = new Set<string>();
    const crewItems = credits
      .filter((c) => c.type === 'crew')
      .filter((c) => {
        const key = `${c.personTmdbId}-${c.job}`;
        if (seenCrew.has(key)) return false;
        seenCrew.add(key);
        return true;
      })
      .sort((a, b) => crewRolePriority(a.job || '') - crewRolePriority(b.job || ''))
      .map((person) => ({
        id: person.personTmdbId,
        name: person.personName,
        imagePath: person.images.find((img) => img.coverType === 'headshot')?.remoteUrl ?? null,
        subtitle: person.job,
        keySuffix: `crew-${person.id}-${person.job || ''}`,
      }));

    return { cast: castItems, crew: crewItems };
  }, [credits]);

  return (
    <div className="space-y-3">
      {cast.length > 0 && (
        <VirtualizedPersonRail
          title="Cast"
          viewAllHref={`/movies/${movieId}/credits?type=cast`}
          items={cast}
          cacheService="radarr"
        />
      )}
      {crew.length > 0 && (
        <VirtualizedPersonRail
          title="Crew"
          viewAllHref={`/movies/${movieId}/credits?type=crew`}
          items={crew}
          cacheService="radarr"
        />
      )}
    </div>
  );
}
