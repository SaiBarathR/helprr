'use client';

import Link from 'next/link';
import { ArrowUpRight, Plus, Sparkles } from 'lucide-react';
import { isMovieFormat, buildSonarrAddParams, buildRadarrAddParams } from '@/lib/anilist-helpers';
import type { AniListMediaFormat } from '@/types/anilist';
import type { DiscoverLibraryStatus } from '@/types';
import { RequestMediaButton } from '@/components/discover/request-media-button';
import { useMe, hasCapability } from '@/components/permission-provider';

interface AnimeAddButtonProps {
  title: string;
  format: AniListMediaFormat | null;
  tvdbId: number | null;
  tmdbId: number | null;
  library?: DiscoverLibraryStatus;
  libraryAvailability?: {
    radarr: 'ok' | 'unavailable';
    sonarr: 'ok' | 'unavailable';
  };
}

export function AnimeAddButton({ title, format, tvdbId, tmdbId, library, libraryAvailability }: AnimeAddButtonProps) {
  const me = useMe();
  const isMovie = isMovieFormat(format);
  const serviceAvailable = isMovie
    ? libraryAvailability?.radarr !== 'unavailable'
    : libraryAvailability?.sonarr !== 'unavailable';

  if (library?.exists && library.id) {
    const targetService = library.type === 'movie' ? 'Movies' : 'TV';
    const href = library.type === 'movie' ? `/movies/${library.id}` : `/series/${library.id}`;

    return (
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 rounded-full bg-background/55 backdrop-blur-md text-foreground px-3 py-1.5 text-[11px] font-medium hover:bg-background/70 transition-colors"
      >
        <Sparkles className="h-3.5 w-3.5" />
        <span className="tracking-widest uppercase">
          Open in {targetService}
        </span>
      </Link>
    );
  }

  const service = isMovie ? 'Radarr' : 'Sonarr';
  const seerrMediaType: 'movie' | 'tv' = isMovie ? 'movie' : 'tv';
  // Direct add (Radarr/Sonarr) needs the service available + the add capability;
  // requesting via Seerr only needs a TMDB id + requests.create when Seerr is set up.
  const canAddDirectly =
    serviceAvailable && hasCapability(me, isMovie ? 'movies.add' : 'series.add');
  const canRequest =
    !!me?.seerrConfigured && hasCapability(me, 'requests.create') && tmdbId != null;

  if (!canAddDirectly && !canRequest) {
    return <></>;
  }

  const href = isMovie
    ? `/movies/add?${buildRadarrAddParams({ title, tmdbId })}`
    : `/series/add?${buildSonarrAddParams({ title, tvdbId })}`;
  const pillClass =
    'inline-flex items-center gap-1.5 rounded-full bg-background/25 backdrop-blur-md text-foreground px-2 py-1.5 text-[11px] font-medium hover:bg-background/70 transition-colors disabled:opacity-60';

  return (
    <div className="flex items-center gap-1.5">
      {canAddDirectly && (
        <Link href={href} className={pillClass}>
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          <span className="tracking-widest">Add to {service}</span>
        </Link>
      )}
      {canRequest && tmdbId != null && (
        <RequestMediaButton tmdbId={tmdbId} mediaType={seerrMediaType} title={title} className={pillClass} />
      )}
    </div>
  );
}
