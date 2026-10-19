'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from '@/components/ui/app-link';
import { ChevronDown, Inbox, Plus, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import type { DiscoverDetail } from '@/types';
import { WatchlistButton } from '@/components/watchlist/watchlist-button';
import { RequestMediaButton } from '@/components/discover/request-media-button';
import { OpenInInstances } from '@/components/discover/open-in-instances';
import { useMe, hasCapability } from '@/components/permission-provider';
import { ScheduledAlertButton } from '@/components/scheduled-alerts/scheduled-alert-dialog';
import { useRequestedMedia } from '@/components/seerr/requested-media-provider';
import type { ContextActionGroup } from '@/components/ui/quick-context-menu';

interface DiscoverAddButtonProps {
  detail: DiscoverDetail;
  controller: DiscoverAddController;
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
  return buildAddPageHref(detail);
}

/** The add page, prefilled; `instanceId` preselects the target instance. */
function buildAddPageHref(detail: DiscoverDetail, instanceId?: string): string {
  const params = new URLSearchParams();
  params.set('term', detail.title);
  params.set('tmdbId', String(detail.tmdbId));
  if (detail.mediaType === 'movie') {
    if (instanceId) params.set('instance', instanceId);
    return `/movies/add?${params.toString()}`;
  }
  if (detail.tvdbId) params.set('tvdbId', String(detail.tvdbId));
  params.set('seriesType', 'standard');
  if (instanceId) params.set('instance', instanceId);
  return `/series/add?${params.toString()}`;
}

export interface DiscoverAddController {
  href: string | null;
  service: 'Radarr' | 'Sonarr';
  seerrMediaType: 'movie' | 'tv';
  canAddDirectly: boolean;
  canRequest: boolean;
  canSchedule: boolean;
  requested: boolean;
  watchlistDraft: {
    source: 'TMDB';
    externalId: string;
    mediaType: 'movie' | 'series';
    title: string;
    year: number | null;
    posterUrl: string | null;
    overview: string | null;
    rating: number | null;
    releaseDate: string | null;
  };
  instances: Array<{ instanceId: string; instanceLabel: string; id: number; titleSlug?: string }>;
  /** Configured instances of the service that do not hold the title yet, each with its add link. */
  missingInstances: Array<{ id: string; label: string; href: string }>;
  watchlistOpen: boolean;
  setWatchlistOpen: (open: boolean) => void;
  scheduleOpen: boolean;
  setScheduleOpen: (open: boolean) => void;
  requestOpen: boolean;
  setRequestOpen: (open: boolean) => void;
  contextGroups: ContextActionGroup[];
}

export function useDiscoverAddController(detail: DiscoverDetail): DiscoverAddController {
  const me = useMe();
  const canRequest = !!me?.seerrConfigured && hasCapability(me, 'requests.create');
  const { isRequested } = useRequestedMedia(canRequest && detail.tmdbId > 0);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const href = buildAddHref(detail);
  const service = detail.mediaType === 'movie' ? 'Radarr' as const : 'Sonarr' as const;
  const seerrMediaType = detail.mediaType === 'movie' ? 'movie' as const : 'tv' as const;
  // Admins can add directly (Radarr/Sonarr); anyone with requests.create can
  // also request via Seerr when it's configured. Members only get Request.
  const canAddDirectly = hasCapability(me, detail.mediaType === 'movie' ? 'movies.add' : 'series.add');
  const canSchedule = hasCapability(me, 'scheduledAlerts.edit');
  const requested = isRequested(seerrMediaType, detail.tmdbId);
  const watchlistDraft = {
    source: 'TMDB' as const,
    externalId: String(detail.tmdbId),
    mediaType: (detail.mediaType === 'movie' ? 'movie' : 'series') as 'movie' | 'series',
    title: detail.title,
    year: detail.year ?? null,
    posterUrl: detail.posterPath,
    overview: detail.overview ?? null,
    rating: typeof detail.rating === 'number' ? detail.rating * 10 : null,
    releaseDate: detail.releaseDate ?? null,
  };

  const instances = detail.library?.instances?.length
    ? detail.library.instances
    : detail.addTarget.id
      ? [{ instanceId: detail.addTarget.instanceId ?? '', instanceLabel: '', id: detail.addTarget.id, titleSlug: detail.library?.titleSlug }]
      : [];
  const targetService = detail.addTarget.service === 'radarr' ? 'Radarr' : 'Sonarr';
  const type: 'movie' | 'series' = detail.addTarget.service === 'radarr' ? 'movie' : 'series';

  // A title can live in several instances with their own profiles, so one held
  // by Radarr A stays addable to Radarr B. If a holder's instance is unknown,
  // offer nothing rather than risk offering the holder itself; an instance whose
  // library could not be read may hold it too, so it is not offered either.
  const wantsOtherInstances = detail.addTarget.exists && canAddDirectly;
  const { data: configured = [] } = useQuery({
    queryKey: queryKeys.arrInstances(),
    queryFn: jsonFetcher<Array<{ id: string; label: string; type: string }>>('/api/instances'),
    enabled: wantsOtherInstances,
    staleTime: 5 * 60_000,
  });
  const held = new Set(instances.map((instance) => instance.instanceId));
  const unchecked = new Set(detail.addTarget.uncheckedInstanceIds ?? []);
  const missingInstances = wantsOtherInstances && !held.has('')
    ? (Array.isArray(configured) ? configured : [])
        .filter((instance) => instance.type === (detail.mediaType === 'movie' ? 'RADARR' : 'SONARR') && !held.has(instance.id) && !unchecked.has(instance.id))
        .map((instance) => ({ id: instance.id, label: instance.label || targetService, href: buildAddPageHref(detail, instance.id) }))
    : [];

  const contextGroups: ContextActionGroup[] = [
    {
      id: 'library',
      actions: detail.addTarget.exists
        ? instances.map((instance) => ({
            id: `open-${instance.instanceId || instance.id}`,
            label: instances.length > 1 && instance.instanceLabel
              ? `Open in ${targetService} · ${instance.instanceLabel}`
              : `Open in ${targetService}`,
            icon: <Check className="h-4 w-4" />,
            href: `${type === 'movie' ? '/movies' : '/series'}/${instance.id}${instance.instanceId ? `?instance=${instance.instanceId}` : ''}`,
          }))
        : [
            ...(canAddDirectly && href ? [{ id: 'add', label: `Add to ${service}`, icon: <Plus className="h-4 w-4" />, href }] : []),
            ...(canRequest ? [{ id: 'request', label: requested ? 'Requested' : 'Request', icon: requested ? <Check className="h-4 w-4" /> : <Inbox className="h-4 w-4" />, onSelect: () => setRequestOpen(true), disabled: requested }] : []),
          ],
    },
  ];

  return {
    href,
    service,
    seerrMediaType,
    canAddDirectly,
    canRequest,
    canSchedule,
    requested,
    watchlistDraft,
    instances,
    missingInstances,
    watchlistOpen,
    setWatchlistOpen,
    scheduleOpen,
    setScheduleOpen,
    requestOpen,
    setRequestOpen,
    contextGroups,
  };
}

export function DiscoverAddButton({ detail, controller }: DiscoverAddButtonProps) {
  const {
    href,
    service,
    seerrMediaType,
    canAddDirectly,
    canRequest,
    canSchedule,
    watchlistDraft,
    instances,
    missingInstances,
    watchlistOpen,
    setWatchlistOpen,
    scheduleOpen,
    setScheduleOpen,
    requestOpen,
    setRequestOpen,
  } = controller;
  if (!href) return null;

  if (detail.addTarget.exists) {
    const targetService = detail.addTarget.service === 'radarr' ? 'Radarr' : 'Sonarr';
    const type: 'movie' | 'series' = detail.addTarget.service === 'radarr' ? 'movie' : 'series';
    return (
      <div className="absolute top-1 right-1 md:top-2 md:right-1.5 hero-meta-fade flex items-center gap-1.5">
        <WatchlistButton
          draft={watchlistDraft}
          variant="icon"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/55 backdrop-blur-md text-foreground hover:bg-background/70"
          open={watchlistOpen}
          onOpenChange={setWatchlistOpen}
        />
        {canSchedule && (
          <ScheduledAlertButton
            draft={watchlistDraft}
            variant="icon"
            className="h-7 w-7"
            open={scheduleOpen}
            onOpenChange={setScheduleOpen}
          />
        )}
        <OpenInInstances
          type={type}
          instances={instances}
          label={`Open in ${targetService}`}
          className="inline-flex items-center gap-1.5 rounded-full bg-background/55 backdrop-blur-md text-foreground px-3 py-1.5 text-[11px] font-medium hover:bg-background/70 transition-colors"
        />
        {missingInstances.length === 1 && (
          <Link
            href={missingInstances[0].href}
            className="inline-flex items-center gap-1.5 rounded-full bg-background/55 backdrop-blur-md text-foreground px-3 py-1.5 text-[11px] font-medium hover:bg-background/70 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            Add to {missingInstances[0].label}
          </Link>
        )}
        {missingInstances.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-full bg-background/55 backdrop-blur-md text-foreground px-3 py-1.5 text-[11px] font-medium hover:bg-background/70 transition-colors">
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              Add to another
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {missingInstances.map((instance) => (
                <DropdownMenuItem key={instance.id} asChild>
                  <Link href={instance.href}>{instance.label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  }

  const pillClass =
    'inline-flex items-center gap-1.5 rounded-full bg-background/25 backdrop-blur-md text-foreground px-2 py-1.5 text-[11px] font-medium hover:bg-background/70 transition-colors disabled:opacity-60';

  return (
    <div className="absolute top-1 right-1 md:top-2 md:right-2 hero-meta-fade flex flex-col items-end gap-1.5 md:flex-row md:items-center">
      <div className="flex items-center gap-1.5">
        {canAddDirectly && (
          <Link href={href} className={pillClass} aria-label={`Add to ${service}`}>
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
            open={requestOpen}
            onOpenChange={setRequestOpen}
          />
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <WatchlistButton
          draft={watchlistDraft}
          variant="icon"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/25 backdrop-blur-md text-foreground hover:bg-background/70"
          open={watchlistOpen}
          onOpenChange={setWatchlistOpen}
        />
        {canSchedule && (
          <ScheduledAlertButton
            draft={watchlistDraft}
            variant="icon"
            className="h-7 w-7"
            open={scheduleOpen}
            onOpenChange={setScheduleOpen}
          />
        )}
      </div>
    </div>
  );
}
