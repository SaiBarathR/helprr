'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Plus } from 'lucide-react';
import { isMovieFormat, buildSonarrAddParams, buildRadarrAddParams } from '@/lib/anilist-helpers';
import type { AniListMediaFormat } from '@/types/anilist';
import type { DiscoverLibraryStatus } from '@/types';

interface AnimeAddButtonProps {
  title: string;
  format: AniListMediaFormat | null;
  tvdbId: number | null;
  tmdbId: number | null;
  library?: DiscoverLibraryStatus;
}

export function AnimeAddButton({ title, format, tvdbId, tmdbId, library }: AnimeAddButtonProps) {
  const isMovie = isMovieFormat(format);

  if (library?.exists && library.id) {
    const href = library.type === 'movie'
      ? `/movies/${library.id}`
      : `/series/${library.id}`;

    return (
      <div>
        <Button asChild variant="secondary" className="w-full h-11 gap-2">
          <Link href={href}>
            <Badge className="bg-green-600/90 text-white gap-1">
              <Check className="h-3 w-3" />
              In Library
            </Badge>
            <span>Open in {library.type === 'movie' ? 'Radarr' : 'Sonarr'}</span>
          </Link>
        </Button>
      </div>
    );
  }

  if (isMovie) {
    const params = buildRadarrAddParams({ title, tmdbId });
    return (
      <div>
        <Button asChild className="w-full h-11 gap-2">
          <Link href={`/movies/add?${params}`}>
            <Plus className="h-4 w-4" />
            Add to Radarr
          </Link>
        </Button>
      </div>
    );
  }

  const params = buildSonarrAddParams({ title, tvdbId });
  return (
    <div className="px-4">
      <Button asChild className="w-full h-11 gap-2">
        <Link href={`/series/add?${params}`}>
          <Plus className="h-4 w-4" />
          Add to Sonarr
        </Link>
      </Button>
    </div>
  );
}
