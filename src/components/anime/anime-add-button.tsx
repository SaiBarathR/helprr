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
        className="inline-flex items-center gap-1.5 rounded-full bg-black/55 backdrop-blur-md text-white px-3 py-1.5 text-[11px] font-medium hover:bg-black/70 transition-colors"
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
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-dashed border-border/50 bg-muted/20 px-5 py-4 opacity-60">
        <div className="min-w-0">
          <p className="tracked-caps text-muted-foreground">Service Offline</p>
          <p className="font-display font-medium text-lg leading-tight text-muted-foreground">
            {service} unavailable
          </p>
        </div>
      </div>
    );
  }

  const href = isMovie
    ? `/movies/add?${buildRadarrAddParams({ title, tmdbId })}`
    : `/series/add?${buildSonarrAddParams({ title, tvdbId })}`;

  return (
    <Link
      href={href}
      className="group relative flex items-center justify-between gap-4 rounded-lg overflow-hidden border border-foreground/15 bg-foreground text-background px-5 py-4 cta-sheen press-feedback transition-shadow shadow-[0_8px_30px_-10px_rgba(0,0,0,0.4)] hover:shadow-[0_12px_40px_-10px_rgba(0,0,0,0.55)]"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/10 ring-1 ring-background/20">
          <Plus className="h-4 w-4" strokeWidth={2.5} />
        </span>
        <div className="min-w-0">
          <p className="tracked-caps text-background/55">New Request</p>
          <p className="font-display font-medium text-lg leading-tight">
            Add to {service}
          </p>
        </div>
      </div>
      <ArrowUpRight
        className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
        strokeWidth={1.5}
      />
    </Link>
  );
}
