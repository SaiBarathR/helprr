'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';

interface Character {
  id: number;
  name: string;
  image: string | null;
  role: string;
  voiceActor: {
    id: number;
    name: string;
    image: string | null;
    language: string | null;
  } | null;
}

interface AnimeCharacterRailProps {
  characters: Character[];
}

export function AnimeCharacterRail({ characters }: AnimeCharacterRailProps) {
  if (!characters.length) return null;

  return (
    <div>
      <h2 className="text-base font-semibold mb-2">Characters &amp; Voice Actors</h2>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-2 px-2 md:-mx-6 md:px-6 scrollbar-hide animate-rail-in">
        {characters.map((char) => {
          const charImgSrc = char.image
            ? toCachedImageSrc(char.image, 'anilist') || char.image
            : null;
          const vaImgSrc = char.voiceActor?.image
            ? toCachedImageSrc(char.voiceActor.image, 'anilist') || char.voiceActor.image
            : null;

          return (
            <div
              key={char.id}
              className="flex-shrink-0 w-[140px] bg-muted/30 rounded-lg overflow-hidden border border-border/30"
            >
              <div className="relative h-[100px] bg-muted/50 flex">
                {/* Character image — clickable */}
                <Link href={`/anime/character/${char.id}`} className="relative w-1/2 h-full hover:opacity-80 transition-opacity">
                  {charImgSrc ? (
                    <Image
                      src={charImgSrc}
                      alt={char.name}
                      fill
                      sizes="70px"
                      className="object-cover"
                      unoptimized={isProtectedApiImageSrc(charImgSrc)}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[10px]">
                      ?
                    </div>
                  )}
                </Link>
                {/* Voice actor image — clickable */}
                <div className="relative w-1/2 h-full border-l border-border/20">
                  {char.voiceActor ? (
                    <Link href={`/anime/staff/${char.voiceActor.id}`} className="block relative w-full h-full hover:opacity-80 transition-opacity">
                      {vaImgSrc ? (
                        <Image
                          src={vaImgSrc}
                          alt={char.voiceActor.name}
                          fill
                          sizes="70px"
                          className="object-cover"
                          unoptimized={isProtectedApiImageSrc(vaImgSrc)}
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[10px] bg-muted/30">
                          —
                        </div>
                      )}
                    </Link>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[10px] bg-muted/30">
                      —
                    </div>
                  )}
                </div>
              </div>
              <div className="p-1.5">
                <Badge
                  variant="outline"
                  className={`text-[9px] mb-0.5 ${char.role === 'MAIN' ? 'border-blue-500/50 text-blue-400' : ''}`}
                >
                  {char.role}
                </Badge>
                <Link href={`/anime/character/${char.id}`} className="block">
                  <p className="text-xs font-medium leading-tight truncate hover:text-primary transition-colors">{char.name}</p>
                </Link>
                {char.voiceActor && (
                  <Link href={`/anime/staff/${char.voiceActor.id}`} className="block">
                    <p className="text-[11px] text-muted-foreground truncate hover:text-primary transition-colors">{char.voiceActor.name}</p>
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
