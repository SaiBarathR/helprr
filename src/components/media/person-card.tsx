'use client';

import Image from 'next/image';
import Link from 'next/link';
import { User } from 'lucide-react';
import {
  isProtectedApiImageSrc,
  toCachedImageSrc,
  type ImageServiceHint,
} from '@/lib/image';

interface PersonCardProps {
  name: string;
  personId: number;
  imagePath?: string | null;
  subtitle?: string;
  cacheService: ImageServiceHint;
}

export function PersonCard({
  name,
  personId,
  imagePath,
  subtitle,
  cacheService,
}: PersonCardProps) {
  const imageSrc = imagePath
    ? toCachedImageSrc(imagePath, cacheService) || imagePath
    : null;

  return (
    <Link
      href={`/discover/person/${personId}`}
      className="shrink-0 flex items-center gap-2.5 rounded-lg bg-muted/50 p-2 pr-3.5 min-w-0"
    >
      <div className="relative w-10 h-10 rounded-full overflow-hidden bg-muted shrink-0">
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={name}
            fill
            sizes="40px"
            className="object-cover"
            unoptimized={isProtectedApiImageSrc(imageSrc)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <User className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="whitespace-nowrap">
        <p className="text-xs font-medium leading-tight">{name}</p>
        {subtitle ? (
          <p className="text-[11px] text-muted-foreground leading-tight">{subtitle}</p>
        ) : null}
      </div>
    </Link>
  );
}
