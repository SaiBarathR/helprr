'use client';

import Link from 'next/link';
import { ArrowUpRight, Plus, Sparkles } from 'lucide-react';
import { isMovieFormat, buildSonarrAddParams, buildRadarrAddParams } from '@/lib/anilist-helpers';
import type { AniListMediaFormat } from '@/types/anilist';
import type { DiscoverLibraryStatus } from '@/types';

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

  if (!serviceAvailable) {
    return <></>
  }

  const href = isMovie
    ? `/movies/add?${buildRadarrAddParams({ title, tmdbId })}`
    : `/series/add?${buildSonarrAddParams({ title, tvdbId })}`;

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-full bg-background/25 backdrop-blur-md text-foreground px-2 py-1.5 text-[11px] font-medium hover:bg-background/70 transition-colors"
    >
      <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
      <span className="tracking-widest">
        Add to {service}
      </span>
    </Link>
  );
}
