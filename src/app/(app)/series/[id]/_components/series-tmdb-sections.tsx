'use client';

import { FadeInImage } from '@/components/media/fade-in-image';
import { DiscoverFilterChip } from '@/components/discover/discover-filter-chip';
import { VirtualizedPersonRail } from '@/components/media/virtualized-person-rail';
import { DiscoverVideoRail } from '@/components/discover/discover-video-rail';
import { DiscoverMediaRail } from '@/components/discover/discover-media-rail';
import { DiscoverWatchProvidersSection } from '@/components/discover/discover-watch-providers';
import type { DiscoverTvFullDetail } from '@/types';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';

export interface SeriesCredits {
  cast: { id: number; name: string; profilePath: string | null; character: string; episodeCount?: number }[];
  crew: { id: number; name: string; profilePath: string | null; job: string }[];
}

/**
 * A non-anime series' (or an unmatched anime's) TMDB sections: cast and crew,
 * videos, recommendations, similar shows, where to watch, networks and
 * production companies.
 */
export function SeriesTmdbSections({
  credits,
  tmdbData,
  seriesId,
  instance,
}: {
  credits: SeriesCredits;
  tmdbData: DiscoverTvFullDetail | null;
  seriesId: number;
  instance: string | undefined;
}) {
  return (
    <>
      {/* Cast & Crew */}
      {credits.cast.length > 0 && (
        <div className="mt-4">
          <VirtualizedPersonRail
            title="Cast"
            titleTextClassName="text-lg font-bold"
            headerClassName="px-2 mb-2"
            viewAllHref={`/series/${seriesId}/credits?type=cast${instance ? `&instance=${instance}` : ''}`}
            items={credits.cast.map((person) => ({
              id: person.id,
              name: person.name,
              imagePath: person.profilePath,
              subtitle: `${person.character}${person.episodeCount ? ` · ${person.episodeCount} ep` : ''}`,
              keySuffix: `cast-${person.character}`,
            }))}
            cacheService="tmdb"
          />
        </div>
      )}
      {credits.crew.length > 0 && (
        <div className="mt-4">
          <VirtualizedPersonRail
            title="Crew"
            titleTextClassName="text-lg font-bold"
            headerClassName="px-2 mb-2"
            viewAllHref={`/series/${seriesId}/credits?type=crew${instance ? `&instance=${instance}` : ''}`}
            items={credits.crew.map((person) => ({
              id: person.id,
              name: person.name,
              imagePath: person.profilePath,
              subtitle: person.job,
              keySuffix: `crew-${person.job}`,
            }))}
            cacheService="tmdb"
          />
        </div>
      )}

      {/* TMDB Enrichment Sections */}
      {tmdbData && (
        <div className="space-y-6 mt-6">
          {tmdbData.videos.length > 0 && (
            <DiscoverVideoRail title="Videos" videos={tmdbData.videos} />
          )}

          {tmdbData.recommendations.length > 0 && (
            <DiscoverMediaRail title="Recommendations" items={tmdbData.recommendations} />
          )}

          {tmdbData.similar.length > 0 && (
            <DiscoverMediaRail title="Similar Shows" items={tmdbData.similar} />
          )}

          {tmdbData.watchProviders && (
            <DiscoverWatchProvidersSection providers={tmdbData.watchProviders} />
          )}

          {tmdbData.networks.length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-2">Networks</h2>
              <div className="flex gap-3 flex-wrap">
                {tmdbData.networks.map((network) => {
                  const logoSrc = network.logoPath
                    ? toCachedImageSrc(
                      network.logoPath.startsWith('http') ? network.logoPath : `https://image.tmdb.org/t/p/w185${network.logoPath}`,
                      'tmdb'
                    )
                    : null;
                  return (
                    <DiscoverFilterChip
                      key={network.id}
                      href={`/discover?networks=${network.id}&networkName=${encodeURIComponent(network.name)}&contentType=show`}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/50 bg-accent/30"
                    >
                      {logoSrc && (
                        <div className="relative h-5 w-8 overflow-hidden rounded-[3px] bg-white">
                          <FadeInImage
                            src={logoSrc}
                            alt={network.name}
                            fill
                            sizes="32px"
                            className="object-contain p-0.5"
                            unoptimized={isProtectedApiImageSrc(logoSrc)}
                          />
                        </div>
                      )}
                      <span className="text-xs font-medium">{network.name}</span>
                    </DiscoverFilterChip>
                  );
                })}
              </div>
            </div>
          )}

          {tmdbData.productionCompanies.length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-2">Production</h2>
              <div className="flex gap-3 flex-wrap">
                {tmdbData.productionCompanies.map((company) => {
                  const logoSrc = company.logoPath
                    ? toCachedImageSrc(
                      company.logoPath.startsWith('http') ? company.logoPath : `https://image.tmdb.org/t/p/w185${company.logoPath}`,
                      'tmdb'
                    )
                    : null;
                  return (
                    <DiscoverFilterChip
                      key={company.id}
                      href={`/discover?companies=${company.id}&companyName=${encodeURIComponent(company.name)}&contentType=show`}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/50 bg-accent/30"
                    >
                      {logoSrc && (
                        <div className="relative h-5 w-8 overflow-hidden rounded-[3px] bg-white">
                          <FadeInImage
                            src={logoSrc}
                            alt={company.name}
                            fill
                            sizes="32px"
                            className="object-contain p-0.5"
                            unoptimized={isProtectedApiImageSrc(logoSrc)}
                          />
                        </div>
                      )}
                      <span className="text-xs font-medium">{company.name}</span>
                    </DiscoverFilterChip>
                  );
                })}
              </div>
            </div>
          )}

          <div className="pb-2" />
        </div>
      )}
    </>
  );
}
