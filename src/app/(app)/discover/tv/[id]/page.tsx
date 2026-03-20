'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/page-spinner';
import { DiscoverHero } from '@/components/discover/discover-hero';
import { VirtualizedPersonRail } from '@/components/media/virtualized-person-rail';
import { DiscoverMediaRail } from '@/components/discover/discover-media-rail';
import { DiscoverVideoRail } from '@/components/discover/discover-video-rail';
import { DiscoverWatchProvidersSection } from '@/components/discover/discover-watch-providers';
import { DiscoverAddButton } from '@/components/discover/discover-add-button';
import { DiscoverExternalLinks } from '@/components/discover/discover-external-links';
import { DiscoverInfoRows } from '@/components/discover/discover-info-rows';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { ChevronDown, ChevronUp, Star, Loader2 } from 'lucide-react';
import type { DiscoverTvFullDetail, DiscoverSeasonDetailResponse, DiscoverSeasonBrief } from '@/types';

export default function DiscoverTvDetailPage() {
  const { id } = useParams();
  const tvId = Number(id);
  const [show, setShow] = useState<DiscoverTvFullDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const [seasonData, setSeasonData] = useState<Record<number, DiscoverSeasonDetailResponse>>({});
  const [seasonLoading, setSeasonLoading] = useState<number | null>(null);

  const loadShow = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setShow(null);
    setError(null);

    if (!Number.isFinite(tvId) || tvId <= 0) {
      setError('Invalid TV show ID');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/discover/tv/${tvId}`, { signal });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to load show');
      }
      const data = await res.json();
      if (signal.aborted) return;
      setShow(data);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Failed to load show');
    } finally {
      if (signal.aborted) return;
      setLoading(false);
    }
  }, [tvId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadShow(controller.signal);
    return () => controller.abort();
  }, [loadShow]);

  const handleToggleSeason = useCallback(async (seasonNumber: number) => {
    if (expandedSeason === seasonNumber) {
      setExpandedSeason(null);
      return;
    }

    setExpandedSeason(seasonNumber);

    if (seasonData[seasonNumber]) return;

    setSeasonLoading(seasonNumber);
    try {
      const res = await fetch(`/api/discover/tv/${tvId}/season/${seasonNumber}`);
      if (res.ok) {
        const data = await res.json();
        setSeasonData((prev) => ({ ...prev, [seasonNumber]: data }));
      }
    } catch {
      // silent fail
    } finally {
      setSeasonLoading(null);
    }
  }, [expandedSeason, seasonData, tvId]);

  const infoRows = useMemo(() => {
    if (!show) return [];
    const rows: { label: string; value: string }[] = [];
    if (show.status) rows.push({ label: 'Status', value: show.status });
    if (show.showType) rows.push({ label: 'Type', value: show.showType });
    rows.push({ label: 'Seasons', value: String(show.numberOfSeasons) });
    rows.push({ label: 'Episodes', value: String(show.numberOfEpisodes) });
    if (show.lastAirDate) rows.push({ label: 'Last Aired', value: show.lastAirDate });
    if (show.nextEpisode) {
      rows.push({
        label: 'Next Episode',
        value: `S${show.nextEpisode.seasonNumber}E${show.nextEpisode.episodeNumber} - ${show.nextEpisode.name}${show.nextEpisode.airDate ? ` (${show.nextEpisode.airDate})` : ''}`,
      });
    }
    if (show.originalLanguage) rows.push({ label: 'Language', value: show.originalLanguage.toUpperCase() });
    if (show.rating > 0) rows.push({ label: 'Rating', value: `${show.rating.toFixed(1)}/10` });
    if (show.voteCount > 0) rows.push({ label: 'Vote Count', value: show.voteCount.toLocaleString() });
    if (show.popularity > 0) rows.push({ label: 'Popularity', value: show.popularity.toFixed(1) });
    return rows;
  }, [show]);

  if (loading) {
    return <><PageHeader title="TV Show" /><PageSpinner /></>;
  }

  if (error || !show) {
    return (
      <>
        <PageHeader title="TV Show" />
        <div className="text-center py-12 text-muted-foreground">
          {error || 'Show not found'}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={show.title} />

      <div className="space-y-5 animate-content-in">
        <DiscoverHero
          title={show.title}
          backdropPath={show.backdropPath}
          posterPath={show.posterPath}
          year={show.year}
          rating={show.rating}
          runtime={show.runtime}
          certification={show.certification}
          tagline={show.tagline}
          mediaType="tv"
        />

        <DiscoverAddButton detail={show} />

        {/* Overview */}
        {show.overview && (
          <div>
            <h2 className="text-base font-semibold mb-1">Overview</h2>
            <div className="relative">
              <p
                className={`text-sm text-muted-foreground leading-relaxed ${
                  !overviewExpanded ? 'line-clamp-3' : ''
                }`}
              >
                {show.overview}
              </p>
              {show.overview.length > 180 && (
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

        {/* Created By */}
        {show.createdBy.length > 0 && (
          <div>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Created by </span>
              {show.createdBy.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ', '}
                  <Link href={`/discover/person/${c.id}`} className="text-primary font-medium">
                    {c.name}
                  </Link>
                </span>
              ))}
            </p>
          </div>
        )}

        {/* Genres */}
        {show.genreNames && show.genreNames.length > 0 && (
          <div>
            <div className="flex flex-wrap gap-1.5">
              {show.genreNames.map((genre) => (
                <Badge key={genre} variant="outline" className="text-xs">{genre}</Badge>
              ))}
            </div>
          </div>
        )}

        {/* Networks */}
        {show.networks.length > 0 && (
          <div>
            <h2 className="text-base font-semibold mb-2">Networks</h2>
            <div className="flex gap-3 flex-wrap">
              {show.networks.map((network) => {
                const logoSrc = network.logoPath
                  ? toCachedImageSrc(`https://image.tmdb.org/t/p/w185${network.logoPath}`, 'tmdb')
                  : null;
                return (
                  <Link key={network.id} href={`/discover?networks=${network.id}&contentType=show`} className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/50 bg-accent/30">
                    {logoSrc && (
                      <div className="relative h-5 w-8">
                        <Image
                          src={logoSrc}
                          alt={network.name}
                          fill
                          sizes="32px"
                          className="object-contain"
                          unoptimized={isProtectedApiImageSrc(logoSrc)}
                        />
                      </div>
                    )}
                    <span className="text-xs font-medium">{network.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Production Companies */}
        {show.productionCompanies.length > 0 && (
          <div>
            <h2 className="text-base font-semibold mb-2">Production Companies</h2>
            <div className="flex gap-3 flex-wrap">
              {show.productionCompanies.map((company) => {
                const logoSrc = company.logoPath
                  ? toCachedImageSrc(`https://image.tmdb.org/t/p/w185${company.logoPath}`, 'tmdb')
                  : null;
                return (
                  <Link key={company.id} href={`/discover?companies=${company.id}&contentType=show`} className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/50 bg-accent/30">
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

        {/* Cast */}
        <VirtualizedPersonRail
          title="Cast"
          viewAllHref={`/discover/tv/${tvId}/credits?type=cast`}
          items={show.cast.map((c) => ({
            id: c.id,
            name: c.name,
            imagePath: c.profilePath,
            subtitle: c.character
              ? `${c.character}${c.episodeCount ? ` · ${c.episodeCount} ep` : ''}`
              : undefined,
            keySuffix: c.character || '',
          }))}
          cacheService="tmdb"
        />

        {/* Crew */}
        {show.crew.length > 0 && (
          <VirtualizedPersonRail
            title="Crew"
            viewAllHref={`/discover/tv/${tvId}/credits?type=crew`}
            items={show.crew.map((c) => ({
              id: c.id,
              name: c.name,
              imagePath: c.profilePath,
              subtitle: c.job,
              keySuffix: c.job,
            }))}
            cacheService="tmdb"
          />
        )}

        {/* Seasons */}
        {show.seasons.length > 0 && (
          <div>
            <h2 className="text-base font-semibold mb-2">Seasons</h2>
            <div className="space-y-2">
              {show.seasons.map((season) => (
                <SeasonCard
                  key={season.seasonNumber}
                  season={season}
                  expanded={expandedSeason === season.seasonNumber}
                  onToggle={() => handleToggleSeason(season.seasonNumber)}
                  seasonDetail={seasonData[season.seasonNumber]}
                  loading={seasonLoading === season.seasonNumber}
                />
              ))}
            </div>
          </div>
        )}

        {/* Videos */}
        <DiscoverVideoRail title="Videos" videos={show.videos} />

        {/* Recommendations */}
        <DiscoverMediaRail title="Recommendations" items={show.recommendations} />

        {/* Similar */}
        <DiscoverMediaRail title="Similar Shows" items={show.similar} />

        {/* Watch Providers */}
        {show.watchProviders && (
          <DiscoverWatchProvidersSection providers={show.watchProviders} />
        )}

        {/* Information */}
        <DiscoverInfoRows title="Information" rows={infoRows} />

        {/* External Links */}
        <DiscoverExternalLinks
          tmdbId={show.tmdbId}
          mediaType="tv"
          imdbId={show.imdbId}
          homepage={show.homepage}
        />
      </div>
    </>
  );
}

function SeasonCard({
  season,
  expanded,
  onToggle,
  seasonDetail,
  loading,
}: {
  season: DiscoverSeasonBrief;
  expanded: boolean;
  onToggle: () => void;
  seasonDetail?: DiscoverSeasonDetailResponse;
  loading: boolean;
}) {
  const posterSrc = season.posterPath
    ? toCachedImageSrc(season.posterPath, 'tmdb') || season.posterPath
    : null;

  return (
    <div className="rounded-xl border border-border/50 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 text-left"
      >
        {posterSrc && (
          <div className="relative w-[45px] h-[67px] rounded-md overflow-hidden bg-muted shrink-0">
            <Image
              src={posterSrc}
              alt={season.name}
              fill
              sizes="45px"
              className="object-cover"
              unoptimized={isProtectedApiImageSrc(posterSrc)}
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold line-clamp-1">{season.name}</p>
          <p className="text-xs text-muted-foreground">
            {season.episodeCount} episodes
            {season.airDate ? ` · ${season.airDate.slice(0, 4)}` : ''}
          </p>
          {season.voteAverage > 0 && (
            <div className="flex items-center gap-0.5 mt-0.5">
              <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
              <span className="text-[10px] text-muted-foreground">{season.voteAverage.toFixed(1)}</span>
            </div>
          )}
        </div>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
        ) : expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && seasonDetail && (
        <div className="border-t border-border/40">
          {seasonDetail.episodes.map((ep) => {
            const stillSrc = ep.stillPath
              ? toCachedImageSrc(ep.stillPath, 'tmdb') || ep.stillPath
              : null;
            return (
              <div
                key={ep.id}
                className="flex gap-3 p-3 border-b border-border/30 last:border-b-0"
              >
                {stillSrc ? (
                  <div className="relative w-[90px] h-[50px] rounded-md overflow-hidden bg-muted shrink-0">
                    <Image
                      src={stillSrc}
                      alt={ep.name}
                      fill
                      sizes="90px"
                      className="object-cover"
                      unoptimized={isProtectedApiImageSrc(stillSrc)}
                    />
                  </div>
                ) : (
                  <div className="w-[90px] h-[50px] rounded-md bg-muted shrink-0 flex items-center justify-center text-xs text-muted-foreground">
                    E{ep.episodeNumber}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold line-clamp-1">
                    {ep.episodeNumber}. {ep.name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                    {ep.airDate && <span>{ep.airDate}</span>}
                    {ep.runtime != null && ep.runtime > 0 && (
                      <>
                        <span>·</span>
                        <span>{ep.runtime}m</span>
                      </>
                    )}
                    {ep.voteAverage > 0 && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-0.5">
                          <Star className="h-2 w-2 fill-yellow-400 text-yellow-400" />
                          {ep.voteAverage.toFixed(1)}
                        </span>
                      </>
                    )}
                  </div>
                  {ep.overview && (
                    <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2 leading-tight">
                      {ep.overview}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {expanded && loading && !seasonDetail && (
        <div className="p-4 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
