'use client';

import Image, { type ImageProps } from 'next/image';
import { useState } from 'react';
import { cn } from '@/lib/utils';

type FadeInImageProps = Omit<ImageProps, 'loading' | 'priority' | 'onLoad'> & {
  /** Eager-load with high fetch priority for above-the-fold posters. Never combined with lazy loading. */
  priority?: boolean;
};

/**
 * Poster `<Image>` with decode fade-in. Uses `loading="lazy"` by default;
 * pass `priority` for the first few above-the-fold items only.
 */
export function FadeInImage({
  priority = false,
  className,
  alt,
  ...props
}: FadeInImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <Image
      {...props}
      alt={alt}
      priority={priority}
      loading={priority ? undefined : 'lazy'}
      onLoad={() => setLoaded(true)}
      className={cn(
        'transition-opacity duration-300',
        loaded ? 'opacity-100' : 'opacity-0',
        className,
      )}
    />
  );
}
