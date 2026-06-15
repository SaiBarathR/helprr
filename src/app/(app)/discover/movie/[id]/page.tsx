'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/page-header';
import { PageSpinner } from '@/components/ui/page-spinner';
import { DiscoverHero } from '@/components/discover/discover-hero';
import { VirtualizedPersonRail } from '@/components/media/virtualized-person-rail';
import { DiscoverMediaRail } from '@/components/discover/discover-media-rail';
import { DiscoverVideoRail } from '@/components/discover/discover-video-rail';
import { DiscoverWatchProvidersSection } from '@/components/discover/discover-watch-providers';
import { DiscoverExternalLinks } from '@/components/discover/discover-external-links';
import { DiscoverInfoRows } from '@/components/discover/discover-info-rows';
import { formatCurrency } from '@/lib/format';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { DiscoverMovieFullDetail } from '@/types';

export default function DiscoverMovieDetailPage() {
  const { id } = useParams();
  const movieId = Number(id);
  const validId = Number.isFinite(movieId) && movieId > 0;
  const [overviewExpanded, setOverviewExpanded] = useState(false);

  const {
    data: movie = null,
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.discoverDetail('movie', movieId),
    queryFn: jsonFetcher<DiscoverMovieFullDetail>(`/api/discover/movie/${movieId}`),
    enabled: validId,
  });

  const loading = validId && isLoading;
  const error = !validId ? 'Invalid movie ID' : isError ? 'Failed to load movie' : null;

  const infoRows = useMemo(() => {
    if (!movie) return [];
    const rows: { label: string; value: string }[] = [];
    if (movie.status) rows.push({ label: 'Status', value: movie.status });
    if (movie.originalLanguage) rows.push({ label: 'Language', value: movie.originalLanguage.toUpperCase() });
    if (movie.rating > 0) rows.push({ label: 'Rating', value: `${movie.rating.toFixed(1)}/10` });
    if (movie.voteCount > 0) rows.push({ label: 'Vote Count', value: movie.voteCount.toLocaleString() });
    if (movie.popularity > 0) rows.push({ label: 'Popularity', value: movie.popularity.toFixed(1) });
    const budget = formatCurrency(movie.budget);
    if (budget) rows.push({ label: 'Budget', value: budget });
    const revenue = formatCurrency(movie.revenue);
    if (revenue) rows.push({ label: 'Revenue', value: revenue });
    return rows;
  }, [movie]);

  if (loading) {
    return <><PageHeader className='-mx-2 md:-mx-6' title="Movie" /><PageSpinner /></>;
  }

  if (error || !movie) {
    return (
      <>
        <PageHeader className='-mx-2 md:-mx-6' title="Movie" />
        <div className="text-center py-12 text-muted-foreground">
          {error || 'Movie not found'}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader className="-mx-2 md:-mx-6" title={movie.title} />

      <div className="space-y-5 animate-content-in">
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
          genres={movie.genreNames}
          detail={movie}
        />

        {/* Overview */}
        {movie.overview && (
          <div>
            <h2 className="text-base font-semibold mb-1">Overview</h2>
            <div className="relative">
              <p
                className={`text-sm text-muted-foreground leading-relaxed ${!overviewExpanded ? 'line-clamp-3' : ''
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

        {/* Cast */}
        <VirtualizedPersonRail
          title="Cast"
          viewAllHref={`/discover/movie/${movieId}/credits?type=cast`}
          items={movie.cast.map((c) => ({
            id: c.id,
            name: c.name,
            imagePath: c.profilePath,
            subtitle: c.character,
            keySuffix: c.character || '',
          }))}
          cacheService="tmdb"
        />

        {/* Crew */}
        {movie.crew.length > 0 && (
          <VirtualizedPersonRail
            title="Crew"
            viewAllHref={`/discover/movie/${movieId}/credits?type=crew`}
            items={movie.crew.map((c) => ({
              id: c.id,
              name: c.name,
              imagePath: c.profilePath,
              subtitle: c.job,
              keySuffix: c.job,
            }))}
            cacheService="tmdb"
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
          <div>
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

        {/* Production Companies */}
        {movie.productionCompanies.length > 0 && (
          <div>
            <h2 className="text-base font-semibold mb-2">Production Companies</h2>
            <div className="flex gap-3 flex-wrap">
              {movie.productionCompanies.map((company) => {
                const logoSrc = company.logoPath
                  ? toCachedImageSrc(`https://image.tmdb.org/t/p/w185${company.logoPath}`, 'tmdb')
                  : null;
                return (
                  <Link key={company.id} href={`/discover?companies=${company.id}&contentType=movie`} className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/50 bg-accent/30">
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
