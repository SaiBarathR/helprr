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
  if (episodeCount) meta.push(`${episodeCount} eps`);

  return (
    <Link
      href={`/discover/person/${id}`}
      className="group flex items-center gap-3 px-4 py-3 border-b border-[color:var(--hairline)] last:border-b-0 hover:bg-[color:var(--amber-soft)]/30 transition-colors"
    >
      <div
        className="relative w-12 h-12 rounded-full overflow-hidden bg-muted/50 shrink-0"
        style={{ boxShadow: '0 0 0 1px var(--hairline)' }}
      >
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
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/70">
            <User className="h-5 w-5" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-display text-[15px] leading-tight truncate group-hover:text-[color:var(--amber)] transition-colors" style={{ letterSpacing: '-0.015em' }}>
          {name}
        </p>
        <p className="text-[12px] text-muted-foreground/85 leading-tight truncate mt-0.5">
          {role}
        </p>
        {meta.length > 0 && (
          <p className="tracked-caps text-[8.5px] text-muted-foreground/65 leading-tight truncate mt-1" style={{ letterSpacing: '0.2em' }}>
            {meta.join(' · ')}
          </p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-[color:var(--amber)]" />
    </Link>
  );
}
