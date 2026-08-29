'use client';

import Image from 'next/image';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A title's own logo art, falling back to a text heading.
 *
 * Deliberately plain `next/image` rather than FadeInImage: a logo is decoration
 * layered over a backdrop, so the right loading state is *nothing* — the
 * backdrop shows through and the logo fades in. FadeInImage's shimmer reserves
 * a filled grey block, which reads as a broken image over artwork. A logo that
 * fails is not worth retrying either; the text heading is a fine outcome.
 */
export function HeroTitle({
  name,
  logoUrl,
  frameClassName,
  textClassName,
  align = 'left',
  as: Tag = 'h1',
}: {
  name: string;
  logoUrl: string | null;
  frameClassName: string;
  textClassName: string;
  align?: 'left' | 'center';
  /**
   * The element the title becomes. It is the page's <h1> on a detail screen,
   * but a billboard sits *inside* a page that already has one — two <h1>s in
   * one document is a duplicate landmark, so the hero passes 'p' there.
   */
  as?: 'h1' | 'p';
}) {
  const [logoFailed, setLogoFailed] = useState(false);

  if (!logoUrl || logoFailed) {
    return <Tag className={textClassName}>{name}</Tag>;
  }

  return (
    <div className={cn('relative', frameClassName)}>
      <Image
        src={logoUrl}
        alt={name}
        fill
        sizes="384px"
        unoptimized
        onError={() => setLogoFailed(true)}
        // Logo art is often dark; a shadow keeps it legible on a dark backdrop.
        className={cn(
          'object-contain [filter:drop-shadow(0_2px_8px_rgb(0_0_0/0.85))]',
          align === 'left' ? 'object-left' : 'object-center',
        )}
      />
      <Tag className="sr-only">{name}</Tag>
    </div>
  );
}
