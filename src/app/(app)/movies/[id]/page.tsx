'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  FileEdit,
  ExternalLink,
  Sparkles,
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
import {
  getDetailViewState,
  setDetailViewState,
  waitForScrollY,
  type DetailViewKey,
} from '@/lib/detail-view-state';
import { useExternalUrls } from '@/lib/hooks/use-external-urls';
import { formatBytes } from '@/lib/format';
import Link from 'next/link';
import { DiscoverVideoRail } from '@/components/discover/discover-video-rail';
import { DiscoverMediaRail } from '@/components/discover/discover-media-rail';
import { DiscoverWatchProvidersSection } from '@/components/discover/discover-watch-providers';
import { RenamePreviewDialog } from '@/components/media/rename-preview-dialog';
import { WatchlistAddDialog } from '@/components/watchlist/watchlist-add-dialog';

type RatingItem = {
  label: string;
  score: string;
  votes: number;
  color: string;
};

function waitForElementScrollY(
  element: HTMLElement,
  targetScrollY: number,
  timeoutMs = 1200,
  pollMs = 50
): Promise<void> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
      if (maxScroll >= targetScrollY || Date.now() - startedAt >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(tick, pollMs);
    };
    tick();
  });
}

function formatRatingVotes(votes: number): string {
  if (!votes) return '';
  if (votes >= 1_000_000) return `${(votes / 1_000_000).toFixed(1)}M`;
  if (votes >= 1_000) return `${(votes / 1_000).toFixed(votes >= 10_000 ? 0 : 1)}K`;
  return String(votes);
}

export default function MovieDetailPage() {
  const { id } = useParams();
  const movieId = Number(id);
  const initialSnapshot = Number.isFinite(movieId) ? getMovieDetailSnapshot(movieId) : null;
  const detailViewKey: DetailViewKey = `movie:${movieId}`;
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const scrollReadyRef = useRef(false);
  const hasRestoredScrollRef = useRef(false);
  const router = useRouter();
  const [movie, setMovie] = useState<RadarrMovie | null>(() => initialSnapshot?.movie ?? null);
  const [loading, setLoading] = useState(() => !initialSnapshot);
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [interactiveSearch, setInteractiveSearch] = useState(false);
  const [showRenamePreview, setShowRenamePreview] = useState(false);
  const [showAddWatchlist, setShowAddWatchlist] = useState(false);
  const externalUrls = useExternalUrls();
  const [jellyfinLoading, setJellyfinLoading] = useState(false);
  const [tmdbData, setTmdbData] = useState<DiscoverMovieFullDetail | null>(() => initialSnapshot?.tmdbData ?? null);

  // Reference data
  const [qualityProfiles, setQualityProfiles] = useState<QualityProfile[]>(() => initialSnapshot?.qualityProfiles ?? []);
  const [tags, setTags] = useState<Tag[]>(() => initialSnapshot?.tags ?? []);
  const [credits, setCredits] = useState<RadarrCredit[]>(() => initialSnapshot?.credits ?? []);
  const creditsRequestIdRef = useRef(0);

  const getCurrentScrollY = useCallback(() => {
    const content = contentScrollRef.current;
    if (content) {
      const maxScroll = Math.max(0, content.scrollHeight - content.clientHeight);
      if (maxScroll > 0 || content.scrollTop > 0) return content.scrollTop;
    }

    if (typeof window === 'undefined') return 0;
    return window.scrollY;
  }, []);

  const persistMovieSnapshot = useCallback((next: {
    movie?: RadarrMovie | null;
    qualityProfiles?: QualityProfile[];
    tags?: Tag[];
    tmdbData?: DiscoverMovieFullDetail | null;
    credits?: RadarrCredit[];
  } = {}) => {
    if (!Number.isFinite(movieId)) return;
    setMovieDetailSnapshot(movieId, {
      movie: next.movie ?? movie,
      qualityProfiles: next.qualityProfiles ?? qualityProfiles,
      tags: next.tags ?? tags,
      tmdbData: next.tmdbData ?? tmdbData,
      credits: next.credits ?? credits,
    });
  }, [credits, movie, movieId, qualityProfiles, tags, tmdbData]);

  const loadData = useCallback(async (hasCachedData: boolean) => {
    if (!hasCachedData) setCredits([]);
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
      const existingSnapshot = getMovieDetailSnapshot(movieId);
      setMovie(nextMovie);
      setQualityProfiles(nextQualityProfiles);
      setTags(nextTags);
      setMovieDetailSnapshot(movieId, {
        movie: nextMovie,
        qualityProfiles: nextQualityProfiles,
        tags: nextTags,
        tmdbData: existingSnapshot?.tmdbData ?? null,
        credits: existingSnapshot?.credits ?? [],
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
          setMovieDetailSnapshot(movieId, {
            movie: nextMovie,
            qualityProfiles: nextQualityProfiles,
            tags: nextTags,
            tmdbData: getMovieDetailSnapshot(movieId)?.tmdbData ?? null,
            credits: nextCredits,
          });
        })
        .catch(() => {
          if (creditsRequestId !== creditsRequestIdRef.current) return;
          if (!hasCachedData) setCredits([]);
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
    scrollReadyRef.current = false;
    hasRestoredScrollRef.current = false;

    if (cached) {
      setMovie(cached.movie);
      setQualityProfiles(cached.qualityProfiles);
      setTags(cached.tags);
      setTmdbData(cached.tmdbData ?? null);
      setCredits(cached.credits ?? []);
      setLoading(false);
    } else {
      setLoading(true);
    }

    void loadData(Boolean(cached));
  }, [loadData, movieId]);

  useEffect(() => {
    if (loading || !movie || hasRestoredScrollRef.current) return;
    const saved = getDetailViewState(detailViewKey);
    if (!saved || saved.scrollY <= 0) {
      hasRestoredScrollRef.current = true;
      scrollReadyRef.current = true;
      return;
    }

    let cancelled = false;
    void (async () => {
      const content = contentScrollRef.current;
      const shouldUseContentScroll = Boolean(
        content && Math.max(0, content.scrollHeight - content.clientHeight) > 0
      );

      if (shouldUseContentScroll && content) {
        await waitForElementScrollY(content, saved.scrollY);
      } else {
        await waitForScrollY(saved.scrollY);
      }

      if (cancelled) return;
      if (shouldUseContentScroll && content) {
        content.scrollTo({ top: saved.scrollY, behavior: 'instant' });
      } else {
        window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
      }
      hasRestoredScrollRef.current = true;
      scrollReadyRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [detailViewKey, loading, movie]);

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

    const content = contentScrollRef.current;
    window.addEventListener('scroll', onScroll, { passive: true });
    content?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', persistScroll);
    return () => {
      persistScroll();
      window.removeEventListener('scroll', onScroll);
      content?.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', persistScroll);
    };
  }, [detailViewKey, getCurrentScrollY, loading, movie]);

  // Background-fetch TMDB enrichment data
  useEffect(() => {
    if (!movie?.tmdbId) {
      setTmdbData(null);
      const cached = Number.isFinite(movieId) ? getMovieDetailSnapshot(movieId) : null;
      if (cached) {
        setMovieDetailSnapshot(movieId, {
          movie: cached.movie,
          qualityProfiles: cached.qualityProfiles,
          tags: cached.tags,
          tmdbData: null,
          credits: cached.credits ?? [],
        });
      }
      return;
    }
    const controller = new AbortController();
    fetch(`/api/discover/movie/${movie.tmdbId}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DiscoverMovieFullDetail | null) => {
        setTmdbData(data);
        const cached = getMovieDetailSnapshot(movieId);
        setMovieDetailSnapshot(movieId, {
          movie: cached?.movie ?? null,
          qualityProfiles: cached?.qualityProfiles ?? [],
          tags: cached?.tags ?? [],
          tmdbData: data,
          credits: cached?.credits ?? [],
        });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setTmdbData((prev) => prev ?? null);
      });
    return () => controller.abort();
  }, [movie?.tmdbId, movieId]);

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
    return <><PageHeader className='-mx-2 md:-mx-6' title="Movie" /><PageSpinner /></>;
  }

  if (!movie) {
    return <div className="text-center py-12 text-muted-foreground">Movie not found</div>;
  }

  const poster = getImageUrl(movie.images, 'poster', 'radarr');
  const qualityProfile = qualityProfiles.find((qp) => qp.id === movie.qualityProfileId);
  const movieTags = tags.filter((t) => movie.tags.includes(t.id));
  const rootFolder = movie.path ? movie.path.split('/').slice(0, -1).join('/') : '';
  const movieFileSize = movie.movieFile?.size ?? movie.sizeOnDisk;

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
    ...(movie.certification ? [{ label: 'Certification', value: movie.certification }] : []),
    ...(movie.runtime > 0 ? [{ label: 'Runtime', value: `${movie.runtime} min` }] : []),
    ...(movieFileSize > 0 ? [{ label: 'File Size', value: formatBytes(movieFileSize) }] : []),
    ...(movieTags.length > 0
      ? [{ label: 'Tags', value: movieTags.map((t) => t.label).join(', ') }]
      : []),
    ...(movie.path ? [{ label: 'Path', value: movie.path }] : []),
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
        className='-mx-2 md:-mx-6'
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
                {movie.genres?.includes('Animation') && (
                  <DropdownMenuItem asChild>
                    <Link href={`/anime/explore?search=${encodeURIComponent(movie.title)}`}>
                      <Sparkles className="h-4 w-4" />
                      Search on AniList
                    </Link>
                  </DropdownMenuItem>
                )}
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
                <DropdownMenuItem onClick={() => setShowAddWatchlist(true)}>
                  <Bookmark className="h-4 w-4" />
                  Add to Watchlist…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => router.push(`/movies/${movie.id}/edit`)}
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowRenamePreview(true)}>
                  <FileEdit className="h-4 w-4" />
                  Preview Rename
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

      <div
        ref={contentScrollRef}
        className="space-y-6 animate-content-in"
        onClickCapture={() => setDetailViewState(detailViewKey, { scrollY: getCurrentScrollY() })}
      >
        {/* Hero: Backdrop or flat poster layout */}
        {tmdbData?.backdropPath ? (
          <div className='-mx-2 md:-mx-6'>
            {/* Backdrop image */}
            <div className="relative w-full h-[220px] overflow-hidden bg-muted/40">
              <Image
                src={toCachedImageSrc(tmdbData.backdropPath, 'tmdb') || tmdbData.backdropPath}
                alt=""
                fill
                sizes="100vw"
                className="object-cover"
                priority
                unoptimized
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
            </div>
            {/* Poster + info overlapping backdrop */}
            <div className="relative -mt-[90px] px-2 md:px-6 flex gap-3.5">
              <div className="w-[100px] shrink-0">
                <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted shadow-lg ring-1 ring-border/20">
                  {poster ? (
                    <Image
                      src={poster}
                      alt={movie.title}
                      fill
                      sizes="100px"
                      className="object-cover"
                      unoptimized={isProtectedApiImageSrc(poster)}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                      <Film className="h-8 w-8" />
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label="Add to watchlist"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowAddWatchlist(true);
                    }}
                    className="absolute top-1.5 right-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/55 backdrop-blur-md text-foreground hover:bg-background/80 shadow-md"
                  >
                    <Bookmark className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-w-0 pt-[60px]">
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
                <h1 className="text-xl font-bold leading-tight line-clamp-2">{movie.title}</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {[
                    movie.year,
                    movie.runtime > 0 ? `${movie.runtime} min` : null,
                    movie.certification || null,
                  ]
                    .filter(Boolean)
                    .join(' \u00B7 ')}
                </p>
                {ratingItems.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-2">
                    {ratingItems.map((ri) => (
                      <div key={ri.label} className="flex items-center gap-1">
                        <Star className={`h-3 w-3 ${ri.color}`} />
                        <span className="text-sm font-semibold">{ri.score}</span>
                        <span className="text-[10px] text-muted-foreground">{ri.label}</span>
                        {ri.votes > 0 && <span className="text-[9px] text-muted-foreground/60">{formatRatingVotes(ri.votes)}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {tmdbData.tagline && (
              <p className="mt-3 text-sm italic text-muted-foreground">&ldquo;{tmdbData.tagline}&rdquo;</p>
            )}
          </div>
        ) : (
          <div className="flex gap-4">
            <div className="w-[120px] shrink-0">
              <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted">
                {poster ? (
                  <Image
                    src={poster}
                    alt={movie.title}
                    fill
                    sizes="120px"
                    className="object-cover"
                    unoptimized={isProtectedApiImageSrc(poster)}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    <Film className="h-10 w-10" />
                  </div>
                )}
                <button
                  type="button"
                  aria-label="Add to watchlist"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowAddWatchlist(true);
                  }}
                  className="absolute top-1.5 right-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/55 backdrop-blur-md text-foreground hover:bg-background/80 shadow-md"
                >
                  <Bookmark className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-w-0 pt-1">
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
              <h1 className="text-xl font-bold leading-tight line-clamp-2">{movie.title}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {[
                  movie.year,
                  movie.runtime > 0 ? `${movie.runtime} min` : null,
                  movie.certification || null,
                ]
                  .filter(Boolean)
                  .join(' \u00B7 ')}
              </p>
              {ratingItems.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-2">
                  {ratingItems.map((ri) => (
                    <div key={ri.label} className="flex items-center gap-1">
                      <Star className={`h-3 w-3 ${ri.color}`} />
                      <span className="text-sm font-semibold">{ri.score}</span>
                      <span className="text-[10px] text-muted-foreground">{ri.label}</span>
                      {ri.votes > 0 && <span className="text-[9px] text-muted-foreground/60">{formatRatingVotes(ri.votes)}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Metadata rows - borderless key-value */}
        {metadataRows.length > 0 && (
          <div>
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
          <div>
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

        {/* Cast & Crew */}
        {credits.length > 0 && <MovieCreditsSection credits={credits} movieId={movieId} />}

        {/* Pill buttons */}
        <div className="flex gap-3">
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
        <div>
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
        <div>
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
              <DiscoverMediaRail title="Similar Movies" items={tmdbData.similar} />
            )}

            {tmdbData.watchProviders && (
              <DiscoverWatchProvidersSection providers={tmdbData.watchProviders} />
            )}

            {tmdbData.productionCompanies.length > 0 && (
              <div>
                <h2 className="text-base font-semibold mb-2">Production</h2>
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
                        className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/50 bg-accent/30"
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
                        <span className="text-xs font-medium">{company.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {tmdbData.collection && (
              <div>
                <Link
                  href={`/discover/collection/${tmdbData.collection.id}`}
                  className="flex items-center gap-3 p-3 rounded-xl bg-muted/60 border border-border/40 hover:bg-muted transition-colors"
                >
                  {tmdbData.collection.posterPath && (
                    <div className="relative w-12 h-[72px] rounded-lg overflow-hidden shrink-0">
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
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Part of</p>
                    <p className="text-sm font-medium line-clamp-1">{tmdbData.collection.name}</p>
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

      <RenamePreviewDialog
        open={showRenamePreview}
        onOpenChange={setShowRenamePreview}
        service="radarr"
        mediaId={movie.id}
        mediaTitle={movie.title}
      />

      <WatchlistAddDialog
        open={showAddWatchlist}
        onOpenChange={setShowAddWatchlist}
        draft={{
          source: 'RADARR',
          externalId: String(movie.id),
          mediaType: 'movie',
          title: movie.title,
          year: movie.year ?? null,
          posterUrl:
            movie.images?.find((i) => i.coverType === 'poster')?.remoteUrl ??
            movie.images?.find((i) => i.coverType === 'poster')?.url ??
            null,
          overview: movie.overview ?? null,
        }}
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
