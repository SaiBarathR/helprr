'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { AniListMediaFormat, AniListMediaStatus, AniListMediaType } from '@/types/anilist';

interface Relation {
  id: number;
  title: string;
  coverImage: string | null;
  format: AniListMediaFormat | null;
  status: AniListMediaStatus | null;
  relationType: string;
  averageScore: number | null;
  episodes: number | null;
  seasonYear: number | null;
  type?: AniListMediaType | null;
  chapters?: number | null;
  volumes?: number | null;
}

interface AnimeRelationsSectionProps {
  relations: Relation[];
}

const RELATION_ORDER = [
  'PREQUEL',
  'SEQUEL',
  'PARENT',
  'SIDE_STORY',
  'ALTERNATIVE',
  'SPIN_OFF',
  'ADAPTATION',
  'SOURCE',
  'CHARACTER',
  'SUMMARY',
  'COMPILATION',
  'CONTAINS',
  'OTHER',
];

function formatRelationType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .split(' ')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

export function AnimeRelationsSection({ relations }: AnimeRelationsSectionProps) {
  if (!relations.length) return null;

  const grouped = new Map<string, Relation[]>();
  for (const rel of relations) {
    const list = grouped.get(rel.relationType) || [];
    list.push(rel);
    grouped.set(rel.relationType, list);
  }

  const sortedGroups = [...grouped.entries()].sort(
    (a, b) => RELATION_ORDER.indexOf(a[0]) - RELATION_ORDER.indexOf(b[0])
  );

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">Relations</h2>
      {sortedGroups.map(([type, items]) => (
        <div key={type}>
          <h3 className="text-sm font-medium text-muted-foreground mb-1.5">
            {formatRelationType(type)}
          </h3>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
            {items.map((rel) => {
              const imgSrc = rel.coverImage
                ? toCachedImageSrc(rel.coverImage, 'anilist') || rel.coverImage
                : null;

              const isManga = rel.type === 'MANGA';
              const href = isManga ? `/anime/manga/${rel.id}` : `/anime/${rel.id}`;

              return (
                <Link
                  key={rel.id}
                  href={href}
                  className="flex-shrink-0 w-[110px] group"
                >
                  <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted border border-border/30 group-hover:border-primary/40 transition-colors">
                    {imgSrc ? (
                      <Image
                        src={imgSrc}
                        alt={rel.title}
                        fill
                        sizes="110px"
                        className="object-cover"
                        unoptimized={isProtectedApiImageSrc(imgSrc)}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs p-2 text-center">
                        {rel.title}
                      </div>
                    )}
                    {rel.format && (
                      <Badge className="absolute top-1 left-1 text-[9px] bg-black/60 text-white">
                        {rel.format.replace('_', ' ')}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs font-medium leading-tight line-clamp-2">{rel.title}</p>
                  {isManga ? (
                    rel.volumes != null || rel.chapters != null ? (
                      <p className="text-[11px] text-muted-foreground">
                        {rel.volumes != null && `${rel.volumes} vols`}
                        {rel.volumes != null && rel.chapters != null && ' · '}
                        {rel.chapters != null && `${rel.chapters} chs`}
                      </p>
                    ) : null
                  ) : (
                    rel.seasonYear && (
                      <p className="text-[11px] text-muted-foreground">{rel.seasonYear}</p>
                    )
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
