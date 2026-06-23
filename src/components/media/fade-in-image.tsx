'use client';

import Image, { type ImageProps } from 'next/image';
import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';

type FadeInImageProps = Omit<ImageProps, 'loading' | 'priority' | 'onLoad' | 'onError'> & {
  /** Eager-load with high fetch priority for above-the-fold posters. Never combined with lazy loading. */
  priority?: boolean;
  onError?: ImageProps['onError'];
};

/**
 * Poster `<Image>` with decode fade-in. Uses `loading="lazy"` by default;
 * pass `priority` for the first few above-the-fold items only.
 */
export function FadeInImage({
  priority = false,
  className,
  alt,
  onError,
  ...props
}: FadeInImageProps) {
  const [loaded, setLoaded] = useState(false);
  const imageRef = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete) setLoaded(true);
  }, []);

  return (
    <Image
      {...props}
      ref={imageRef}
      alt={alt}
      priority={priority}
      loading={priority ? undefined : 'lazy'}
      onLoad={() => setLoaded(true)}
      onError={(event) => {
        setLoaded(true);
        onError?.(event);
      }}
      className={cn(
        'transition-opacity duration-300',
        loaded ? 'opacity-100' : 'opacity-0',
        className,
      )}
    />
  );
}
