'use client';

import { PersonCard } from '@/components/media/person-card';

interface CastMember {
  id: number;
  name: string;
  character?: string;
  profilePath: string | null;
  episodeCount?: number;
}

interface DiscoverCastRailProps {
  title: string;
  cast: CastMember[];
}

export function DiscoverCastRail({ title, cast }: DiscoverCastRailProps) {
  if (!cast.length) return null;

  return (
    <div>
      <h2 className="text-base font-semibold px-4 mb-2">{title}</h2>
      <div className="flex gap-2.5 overflow-x-auto pb-1 px-4 scrollbar-hide">
        {cast.map((person) => {
          return (
            <PersonCard
              key={`${person.id}-${person.character || ''}`}
              name={person.name}
              personId={person.id}
              imagePath={person.profilePath}
              subtitle={person.character
                ? `${person.character}${person.episodeCount ? ` · ${person.episodeCount} ep` : ''}`
                : undefined}
              cacheService="tmdb"
            />
          );
        })}
      </div>
    </div>
  );
}
