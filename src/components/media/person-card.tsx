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
      className="group shrink-0 flex items-center gap-2.5 bg-card/40 hover:bg-card/70 border border-[color:var(--hairline)] hover:border-[color:var(--amber-soft)] p-2 pr-3.5 min-w-0 transition-colors press-feedback"
      style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
    >
      <div
        className="relative w-10 h-10 rounded-full overflow-hidden bg-muted/50 shrink-0"
        style={{ boxShadow: '0 0 0 1px var(--hairline)' }}
      >
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
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/70">
            <User className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="whitespace-nowrap">
        <p className="font-display text-[13px] leading-tight group-hover:text-[color:var(--amber)] transition-colors" style={{ letterSpacing: '-0.01em' }}>
          {name}
        </p>
        {subtitle ? (
          <p className="tracked-caps text-[8.5px] text-muted-foreground/80 leading-tight mt-0.5" style={{ letterSpacing: '0.18em' }}>
            {subtitle}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
