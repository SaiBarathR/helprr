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
      <div className="flex gap-3 overflow-x-auto pb-1 px-4 scrollbar-hide">
        {cast.map((person) => {
          const src = person.profilePath
            ? toCachedImageSrc(person.profilePath, 'tmdb') || person.profilePath
            : null;
          return (
            <Link
              key={`${person.id}-${person.character || ''}`}
              href={`/discover/person/${person.id}`}
              className="shrink-0 w-[72px] text-center group"
            >
              <div className="relative w-[72px] h-[72px] rounded-full overflow-hidden bg-muted mx-auto">
                {src ? (
                  <Image
                    src={src}
                    alt={person.name}
                    fill
                    sizes="72px"
                    className="object-cover"
                    unoptimized={isProtectedApiImageSrc(src)}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    <User className="h-6 w-6" />
                  </div>
                )}
              </div>
              <p className="text-[11px] font-medium mt-1.5 line-clamp-2 leading-tight">{person.name}</p>
              {person.character && (
                <p className="text-[10px] text-muted-foreground line-clamp-1 leading-tight">
                  {person.character}
                  {person.episodeCount ? ` (${person.episodeCount} ep)` : ''}
                </p>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
