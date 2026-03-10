'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DiscoverHero } from '@/components/discover/discover-hero';
import { DiscoverCastRail } from '@/components/discover/discover-cast-rail';
import { DiscoverMediaRail } from '@/components/discover/discover-media-rail';
import { DiscoverVideoRail } from '@/components/discover/discover-video-rail';
import { DiscoverWatchProvidersSection } from '@/components/discover/discover-watch-providers';
import { DiscoverAddButton } from '@/components/discover/discover-add-button';
import { DiscoverExternalLinks } from '@/components/discover/discover-external-links';
import { DiscoverInfoRows } from '@/components/discover/discover-info-rows';
import { formatCurrency } from '@/lib/format';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { DiscoverMovieFullDetail } from '@/types';

export default function DiscoverMovieDetailPage() {
  const { id } = useParams();
  const movieId = Number(id);
  const [movie, setMovie] = useState<DiscoverMovieFullDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const requestIdRef = useRef(0);

  const loadMovie = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setMovie(null);
    setError(null);

    if (!Number.isFinite(movieId) || movieId <= 0) {
      if (requestId !== requestIdRef.current) return;
      setError('Invalid movie ID');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/discover/movie/${movieId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to load movie');
      }
      const data = await res.json();
      if (requestId !== requestIdRef.current) return;
      setMovie(data);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load movie');
    } finally {
      if (requestId !== requestIdRef.current) return;
      setLoading(false);
    }
  }, [movieId]);

  useEffect(() => {
    void loadMovie();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadMovie]);

  const infoRows = useMemo(() => {
    if (!movie) return [];
    const rows: { label: string; value: string }[] = [];
    if (movie.status) rows.push({ label: 'Status', value: movie.status });
    if (movie.originalLanguage) rows.push({ label: 'Language', value: movie.originalLanguage.toUpperCase() });
    const budget = formatCurrency(movie.budget);
    if (budget) rows.push({ label: 'Budget', value: budget });
    const revenue = formatCurrency(movie.revenue);
    if (revenue) rows.push({ label: 'Revenue', value: revenue });
    if (movie.productionCompanies.length) {
      rows.push({ label: 'Production', value: movie.productionCompanies.map((c) => c.name).join(', ') });
    }
    return rows;
  }, [movie]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-[220px] w-full" />
        <div className="flex gap-3.5 px-4 -mt-[90px] relative z-10">
          <Skeleton className="w-[100px] h-[150px] rounded-lg shrink-0" />
          <div className="flex-1 pt-[60px] space-y-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        <div className="px-4 space-y-2 mt-6">
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  if (error || !movie) {
    return (
      <>
        <PageHeader title="Movie" />
        <div className="text-center py-12 text-muted-foreground">
          {error || 'Movie not found'}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={movie.title} />

      <div className="space-y-5 pb-8">
        <DiscoverHero
          title={movie.title}
          backdropPath={movie.backdropPath}
          posterPath={movie.posterPath}
          year={movie.year}
          rating={movie.rating}
          runtime={movie.runtime}
          certification={movie.certification}
          tagline={movie.tagline}
          mediaType="movie"
          isAnime={movie.isAnime}
        />

        <DiscoverAddButton detail={movie} />

        {/* Overview */}
        {movie.overview && (
          <div className="px-4">
            <h2 className="text-base font-semibold mb-1">Overview</h2>
            <div className="relative">
              <p
                className={`text-sm text-muted-foreground leading-relaxed ${
                  !overviewExpanded ? 'line-clamp-3' : ''
                }`}
              >
                {movie.overview}
              </p>
              {movie.overview.length > 180 && (
                <button
                  onClick={() => setOverviewExpanded(!overviewExpanded)}
                  className="text-sm text-primary font-medium mt-1"
                >
                  {overviewExpanded ? 'less' : 'more...'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Genres */}
        {movie.genreNames && movie.genreNames.length > 0 && (
          <div className="px-4">
            <div className="flex flex-wrap gap-1.5">
              {movie.genreNames.map((genre) => (
                <Badge key={genre} variant="outline" className="text-xs">{genre}</Badge>
              ))}
            </div>
          </div>
        )}

        {/* Cast */}
        <DiscoverCastRail
          title="Cast"
          cast={movie.cast.map((c) => ({
            id: c.id,
            name: c.name,
            character: c.character,
            profilePath: c.profilePath,
          }))}
        />

        {/* Key Crew */}
        {movie.crew.length > 0 && (
          <DiscoverCastRail
            title="Crew"
            cast={movie.crew.map((c) => ({
              id: c.id,
              name: c.name,
              character: c.job,
              profilePath: c.profilePath,
            }))}
          />
        )}

        {/* Videos */}
        <DiscoverVideoRail title="Videos" videos={movie.videos} />

        {/* Recommendations */}
        <DiscoverMediaRail title="Recommendations" items={movie.recommendations} />

        {/* Similar */}
        <DiscoverMediaRail title="Similar Movies" items={movie.similar} />

        {/* Watch Providers */}
        {movie.watchProviders && (
          <DiscoverWatchProvidersSection providers={movie.watchProviders} />
        )}

        {/* Collection */}
        {movie.collection && (
          <div className="px-4">
            <h2 className="text-base font-semibold mb-2">Collection</h2>
            <Link
              href={`/discover/collection/${movie.collection.id}`}
              className="flex gap-3 rounded-xl border border-border/50 bg-accent/30 p-3 items-center"
            >
              {movie.collection.posterPath && (
                <div className="relative w-[60px] h-[90px] rounded-lg overflow-hidden bg-muted shrink-0">
                  <Image
                    src={toCachedImageSrc(movie.collection.posterPath, 'tmdb') || movie.collection.posterPath}
                    alt={movie.collection.name}
                    fill
                    sizes="60px"
                    className="object-cover"
                    unoptimized={isProtectedApiImageSrc(
                      toCachedImageSrc(movie.collection.posterPath, 'tmdb') || movie.collection.posterPath
                    )}
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold line-clamp-2">{movie.collection.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">View all movies in this collection</p>
              </div>
            </Link>
          </div>
        )}

        {/* Information */}
        <DiscoverInfoRows title="Information" rows={infoRows} />

        {/* External Links */}
        <DiscoverExternalLinks
          tmdbId={movie.tmdbId}
          mediaType="movie"
          imdbId={movie.imdbId}
          homepage={movie.homepage}
        />
      </div>
    </>
  );
}
