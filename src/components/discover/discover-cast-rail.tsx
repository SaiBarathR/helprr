'use client';

import Image from 'next/image';
import Link from 'next/link';
import { User } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';

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
          const src = person.profilePath
            ? toCachedImageSrc(person.profilePath, 'tmdb') || person.profilePath
            : null;
          return (
            <Link
              key={`${person.id}-${person.character || ''}`}
              href={`/discover/person/${person.id}`}
              className="shrink-0 flex items-center gap-2.5 rounded-lg bg-muted/50 p-2 pr-3.5 min-w-0"
            >
              <div className="relative w-10 h-10 rounded-full overflow-hidden bg-muted shrink-0">
                {src ? (
                  <Image
                    src={src}
                    alt={person.name}
                    fill
                    sizes="40px"
                    className="object-cover"
                    unoptimized={isProtectedApiImageSrc(src)}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>
              <div className="whitespace-nowrap">
                <p className="text-xs font-medium leading-tight">{person.name}</p>
                {person.character && (
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    {person.character}
                    {person.episodeCount ? ` · ${person.episodeCount} ep` : ''}
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
