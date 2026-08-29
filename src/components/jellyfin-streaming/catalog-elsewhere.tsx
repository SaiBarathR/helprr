'use client';

import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { useCan } from '@/components/permission-provider';
import { toCachedImageSrc } from '@/lib/image';
import type { DiscoverMovieFullDetail, DiscoverTvFullDetail, DiscoverWatchProviderEntry } from '@/types';

const GROUPS: Array<{ key: 'flatrate' | 'rent' | 'buy'; label: string }> = [
  { key: 'flatrate', label: 'Stream' },
  { key: 'rent', label: 'Rent' },
  { key: 'buy', label: 'Buy' },
];

/**
 * Where else a title can be watched, plus the TMDB score.
 *
 * The reference install gets this from a Jellyfin plugin; Helprr already has
 * TMDB wired through `/api/discover`, which returns region-aware watch
 * providers — so this is Helprr's own data rather than a new integration.
 */
export function CatalogElsewhere({
  tmdbId,
  mediaType,
}: {
  tmdbId?: number;
  mediaType: 'movie' | 'tv';
}) {
  const canDiscover = useCan('discover.view');
  const query = useQuery({
    queryKey: queryKeys.discoverDetail(mediaType, tmdbId),
    queryFn: jsonFetcher<DiscoverMovieFullDetail | DiscoverTvFullDetail>(`/api/discover/${mediaType}/${tmdbId}`),
    enabled: canDiscover && Boolean(tmdbId),
    staleTime: 30 * 60_000,
  });

  const detail = query.data;
  const providers = detail?.watchProviders;
  const groups = GROUPS
    .map((group) => ({ ...group, entries: (providers?.[group.key] ?? []) as DiscoverWatchProviderEntry[] }))
    .filter((group) => group.entries.length > 0);

  if (!detail || groups.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-semibold tracking-tight">Also available on</h2>
        {providers?.region && (
          <span className="text-[11px] text-muted-foreground">{providers.region}</span>
        )}
      </div>
      <div className="space-y-2 rounded-xl border bg-card/60 p-3">
        {groups.map((group) => (
          <div key={group.key} className="flex flex-wrap items-center gap-2">
            <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground">{group.label}</span>
            {group.entries.map((entry) => {
              const logo = toCachedImageSrc(entry.logoPath, 'tmdb');
              return (
                <span
                  key={`${group.key}-${entry.providerId}`}
                  title={entry.providerName}
                  className="flex items-center gap-1.5 rounded-full border border-border/50 bg-background/60 py-1 pr-2.5 pl-1 backdrop-blur"
                >
                  {logo && (
                    <span className="relative size-5 overflow-hidden rounded-full">
                      <Image src={logo} alt="" fill sizes="20px" unoptimized className="object-cover" />
                    </span>
                  )}
                  <span className="text-xs">{entry.providerName}</span>
                </span>
              );
            })}
          </div>
        ))}
        {providers?.link && (
          <a
            href={providers.link}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-[11px] text-muted-foreground hover:text-foreground"
          >
            Availability via TMDB / JustWatch
          </a>
        )}
      </div>
    </section>
  );
}
