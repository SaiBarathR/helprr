'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ChevronRight, User } from 'lucide-react';
import {
  isProtectedApiImageSrc,
  toCachedImageSrc,
  type ImageServiceHint,
} from '@/lib/image';

interface PersonRowProps {
  id: number;
  name: string;
  imagePath: string | null;
  role: string;
  department?: string;
  episodeCount?: number;
  cacheService: ImageServiceHint;
}

export function PersonRow({
  id,
  name,
  imagePath,
  role,
  department,
  episodeCount,
  cacheService,
}: PersonRowProps) {
  const imageSrc = imagePath
    ? toCachedImageSrc(imagePath, cacheService) || imagePath
    : null;

  const meta: string[] = [];
  if (department) meta.push(department);
  if (episodeCount) meta.push(`${episodeCount} episodes`);

  return (
    <Link
      href={`/discover/person/${id}`}
      className="flex items-center gap-3 px-4 py-3"
    >
      <div className="relative w-12 h-12 rounded-full overflow-hidden bg-muted shrink-0">
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={name}
            fill
            sizes="48px"
            className="object-cover"
            unoptimized={isProtectedApiImageSrc(imageSrc)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <User className="h-5 w-5" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-tight truncate">{name}</p>
        <p className="text-xs text-muted-foreground leading-tight truncate mt-0.5">
          {role}
        </p>
        {meta.length > 0 && (
          <p className="text-[11px] text-muted-foreground/70 leading-tight truncate mt-0.5">
            {meta.join(' \u00B7 ')}
          </p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
