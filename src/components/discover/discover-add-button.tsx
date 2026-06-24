'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import type { DiscoverDetail } from '@/types';
import { WatchlistButton } from '@/components/watchlist/watchlist-button';
import { RequestMediaButton } from '@/components/discover/request-media-button';
import { OpenInInstances } from '@/components/discover/open-in-instances';
import { useMe, hasCapability } from '@/components/permission-provider';
import { ScheduledAlertButton } from '@/components/scheduled-alerts/scheduled-alert-dialog';
import { tmdbImageUrl } from '@/lib/discover';

interface DiscoverAddButtonProps {
  detail: DiscoverDetail;
}

function buildAddHref(detail: DiscoverDetail): string | null {
  if (detail.addTarget.exists && detail.addTarget.id) {
    // Carry the matched item's instance so the detail page caches under the same
    // ?instance= slot the optimistic monitor writes use (mirrors anime-add-button).
    const q = detail.addTarget.instanceId ? `?instance=${detail.addTarget.instanceId}` : '';
    return detail.addTarget.service === 'radarr'
      ? `/movies/${detail.addTarget.id}${q}`
      : `/series/${detail.addTarget.id}${q}`;
  }

  if (detail.mediaType === 'movie') {
    const params = new URLSearchParams();
    params.set('term', detail.title);
    params.set('tmdbId', String(detail.tmdbId));
    return `/movies/add?${params.toString()}`;
  }

  const params = new URLSearchParams();
  params.set('term', detail.title);
  params.set('tmdbId', String(detail.tmdbId));
  if (detail.tvdbId) params.set('tvdbId', String(detail.tvdbId));
  params.set('seriesType', 'standard');
  return `/series/add?${params.toString()}`;
}

export function DiscoverAddButton({ detail }: DiscoverAddButtonProps) {
  const me = useMe();
  const href = buildAddHref(detail);
  if (!href) return null;

  const service = detail.mediaType === 'movie' ? 'Radarr' : 'Sonarr';
  const seerrMediaType = detail.mediaType === 'movie' ? 'movie' : 'tv';
  // Admins can add directly (Radarr/Sonarr); anyone with requests.create can
  // also request via Seerr when it's configured. Members only get Request.
  const canAddDirectly = hasCapability(me, detail.mediaType === 'movie' ? 'movies.add' : 'series.add');
  const canRequest = !!me?.seerrConfigured && hasCapability(me, 'requests.create');
  const watchlistDraft = {
    source: 'TMDB' as const,
    externalId: String(detail.tmdbId),
    mediaType: (detail.mediaType === 'movie' ? 'movie' : 'series') as 'movie' | 'series',
    title: detail.title,
    year: detail.year ?? null,
    posterUrl: tmdbImageUrl(detail.posterPath, 'w500'),
    overview: detail.overview ?? null,
    rating: typeof detail.rating === 'number' ? detail.rating * 10 : null,
    releaseDate: detail.releaseDate ?? null,
  };

  if (detail.addTarget.exists) {
    const targetService = detail.addTarget.service === 'radarr' ? 'Radarr' : 'Sonarr';
    const type: 'movie' | 'series' = detail.addTarget.service === 'radarr' ? 'movie' : 'series';
    // The matched title may live in more than one instance (DiscoverDetail already
    // carries the full library); fall back to the addTarget when the list is absent.
    const instances = detail.library?.instances?.length
      ? detail.library.instances
      : detail.addTarget.id
        ? [{ instanceId: detail.addTarget.instanceId ?? '', instanceLabel: '', id: detail.addTarget.id, titleSlug: detail.library?.titleSlug }]
        : [];
    return (
      <div className="absolute top-1 right-1 md:top-2 md:right-1.5 hero-meta-fade flex items-center gap-1.5">
        <WatchlistButton
          draft={watchlistDraft}
          variant="icon"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/55 backdrop-blur-md text-foreground hover:bg-background/70"
        />
        {hasCapability(me, 'scheduledAlerts.edit') && (
          <ScheduledAlertButton draft={watchlistDraft} variant="icon" className="h-7 w-7" />
        )}
        <OpenInInstances
          type={type}
          instances={instances}
          label={`Open in ${targetService}`}
          className="inline-flex items-center gap-1.5 rounded-full bg-background/55 backdrop-blur-md text-foreground px-3 py-1.5 text-[11px] font-medium hover:bg-background/70 transition-colors"
        />
      </div>
    );
  }

  const pillClass =
    'inline-flex items-center gap-1.5 rounded-full bg-background/25 backdrop-blur-md text-foreground px-2 py-1.5 text-[11px] font-medium hover:bg-background/70 transition-colors disabled:opacity-60';

  return (
    <div className="absolute top-1 right-1 md:top-2 md:right-2 hero-meta-fade flex flex-col items-end gap-1.5 md:flex-row md:items-center">
      <div className="flex items-center gap-1.5">
        {canAddDirectly && (
          <Link href={href} className={pillClass}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            <span className="tracking-widest">{service}</span>
          </Link>
        )}
        {canRequest && (
          <RequestMediaButton
            tmdbId={detail.tmdbId}
            mediaType={seerrMediaType}
            title={detail.title}
            className={pillClass}
          />
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <WatchlistButton
          draft={watchlistDraft}
          variant="icon"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/25 backdrop-blur-md text-foreground hover:bg-background/70"
        />
        {hasCapability(me, 'scheduledAlerts.edit') && (
          <ScheduledAlertButton draft={watchlistDraft} variant="icon" className="h-7 w-7" />
        )}
      </div>
    </div>
  );
}
