'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { PageHeader } from '@/components/layout/page-header';
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

      <div className="space-y-6 animate-content-in">
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
          inLibrary={show.addTarget?.exists}
          genres={show.genreNames}
        />

        <DiscoverAddButton detail={show} />

        {/* Overview */}
        {show.overview && (
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
                {show.overview}
              </p>
              {show.overview.length > 180 && (
                <button
                  onClick={() => setOverviewExpanded(!overviewExpanded)}
                  className="press-feedback tracked-caps text-[9.5px] text-[color:var(--amber)] mt-2 hover:underline"
                >
                  {overviewExpanded ? '— Show less' : '— Read more'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Created By */}
        {show.createdBy.length > 0 && (
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="tracked-caps text-[9px] text-muted-foreground" style={{ letterSpacing: '0.24em' }}>
              Created by
            </span>
            {show.createdBy.map((c, i) => (
              <span key={c.id} className="text-[13px]">
                {i > 0 && <span className="text-muted-foreground/40 mx-1">·</span>}
                <Link href={`/discover/person/${c.id}`} className="font-display text-[color:var(--amber)] hover:underline" style={{ letterSpacing: '-0.01em' }}>
                  {c.name}
                </Link>
              </span>
            ))}
          </div>
        )}

        {/* Networks */}
        {show.networks.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="reel" aria-hidden />
              <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
                Networks
              </h2>
              <span className="hairline flex-1" aria-hidden />
            </div>
            <div className="flex gap-2 flex-wrap">
              {show.networks.map((network) => {
                const logoSrc = network.logoPath
                  ? toCachedImageSrc(`https://image.tmdb.org/t/p/w185${network.logoPath}`, 'tmdb')
                  : null;
                return (
                  <Link
                    key={network.id}
                    href={`/discover?networks=${network.id}&contentType=show`}
                    className="press-feedback inline-flex items-center gap-2 px-2.5 py-1.5 border border-[color:var(--hairline)] bg-card/40 hover:border-[color:var(--amber-soft)] hover:bg-card/70 transition-colors"
                    style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
                  >
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
                    <span className="text-[11.5px] font-medium">{network.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Production Companies */}
        {show.productionCompanies.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="reel" aria-hidden />
              <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
                Production
              </h2>
              <span className="hairline flex-1" aria-hidden />
            </div>
            <div className="flex gap-2 flex-wrap">
              {show.productionCompanies.map((company) => {
                const logoSrc = company.logoPath
                  ? toCachedImageSrc(`https://image.tmdb.org/t/p/w185${company.logoPath}`, 'tmdb')
                  : null;
                return (
                  <Link
                    key={company.id}
                    href={`/discover?companies=${company.id}&contentType=show`}
                    className="press-feedback inline-flex items-center gap-2 px-2.5 py-1.5 border border-[color:var(--hairline)] bg-card/40 hover:border-[color:var(--amber-soft)] hover:bg-card/70 transition-colors"
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
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="reel" aria-hidden />
              <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
                Seasons · {show.seasons.length}
              </h2>
              <span className="hairline flex-1" aria-hidden />
            </div>
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
    <div
      className="border border-[color:var(--hairline)] bg-card/40 overflow-hidden transition-colors hover:border-[color:var(--amber-soft)]"
      style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
    >
      <button
        onClick={onToggle}
        className="press-feedback w-full flex items-center gap-3 p-3 text-left"
      >
        {posterSrc ? (
          <div
            className="relative w-[48px] h-[72px] overflow-hidden bg-muted/40 shrink-0"
            style={{ borderRadius: 'calc(var(--radius) - 3px)', boxShadow: '0 0 0 1px var(--hairline)' }}
          >
            <Image
              src={posterSrc}
              alt={season.name}
              fill
              sizes="48px"
              className="object-cover"
              unoptimized={isProtectedApiImageSrc(posterSrc)}
            />
          </div>
        ) : (
          <div
            className="w-[48px] h-[72px] bg-muted/30 shrink-0 flex items-center justify-center"
            style={{ borderRadius: 'calc(var(--radius) - 3px)', boxShadow: '0 0 0 1px var(--hairline)' }}
          >
            <span className="font-mono tabular tracked-mid text-[11px] text-[color:var(--amber)]" style={{ letterSpacing: '0.18em' }}>
              S{String(season.seasonNumber).padStart(2, '0')}
            </span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-display text-[14.5px] line-clamp-1" style={{ letterSpacing: '-0.012em' }}>{season.name}</p>
          <p className="font-mono tabular text-[10.5px] text-muted-foreground/85 mt-0.5">
            {season.episodeCount} episodes
            {season.airDate ? ` · ${season.airDate.slice(0, 4)}` : ''}
          </p>
          {season.voteAverage > 0 && (
            <div className="flex items-center gap-0.5 mt-1">
              <Star className="h-2.5 w-2.5 fill-[color:var(--amber)] text-[color:var(--amber)]" />
              <span className="font-mono tabular text-[10px] text-[color:var(--amber)]">{season.voteAverage.toFixed(1)}</span>
            </div>
          )}
        </div>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-[color:var(--amber)] shrink-0" />
        ) : expanded ? (
          <ChevronUp className="h-4 w-4 text-[color:var(--amber)] shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && seasonDetail && (
        <div className="border-t border-[color:var(--hairline)]">
          {seasonDetail.episodes.map((ep) => {
            const stillSrc = ep.stillPath
              ? toCachedImageSrc(ep.stillPath, 'tmdb') || ep.stillPath
              : null;
            return (
              <div
                key={ep.id}
                className="flex gap-3 p-3 border-b border-[color:var(--hairline)] last:border-b-0"
              >
                {stillSrc ? (
                  <div
                    className="relative w-[100px] h-[56px] overflow-hidden bg-muted shrink-0"
                    style={{ borderRadius: 'calc(var(--radius) - 3px)', boxShadow: '0 0 0 1px var(--hairline)' }}
                  >
                    <Image
                      src={stillSrc}
                      alt={ep.name}
                      fill
                      sizes="100px"
                      className="object-cover"
                      unoptimized={isProtectedApiImageSrc(stillSrc)}
                    />
                  </div>
                ) : (
                  <div
                    className="w-[100px] h-[56px] bg-muted/30 shrink-0 flex items-center justify-center font-mono tabular text-[11px] text-muted-foreground"
                    style={{ borderRadius: 'calc(var(--radius) - 3px)', boxShadow: '0 0 0 1px var(--hairline)' }}
                  >
                    E{String(ep.episodeNumber).padStart(2, '0')}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-display text-[12.5px] line-clamp-1" style={{ letterSpacing: '-0.01em' }}>
                    <span className="text-[color:var(--amber)] font-mono tabular text-[10px] mr-1.5">E{String(ep.episodeNumber).padStart(2, '0')}</span>
                    {ep.name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1 font-mono tabular text-[10px] text-muted-foreground/80">
                    {ep.airDate && <span>{ep.airDate}</span>}
                    {ep.runtime != null && ep.runtime > 0 && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span>{ep.runtime}m</span>
                      </>
                    )}
                    {ep.voteAverage > 0 && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="inline-flex items-center gap-0.5 text-[color:var(--amber)]">
                          <Star className="h-2 w-2 fill-[color:var(--amber)]" />
                          {ep.voteAverage.toFixed(1)}
                        </span>
                      </>
                    )}
                  </div>
                  {ep.overview && (
                    <p className="text-[10.5px] text-muted-foreground/85 mt-1 line-clamp-2 leading-snug">
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
          <Loader2 className="h-5 w-5 animate-spin text-[color:var(--amber)]" />
        </div>
      )}
    </div>
  );
}
