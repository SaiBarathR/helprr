'use client';

import Image, { type ImageProps } from 'next/image';
import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';

type FadeInImageProps = Omit<ImageProps, 'loading' | 'priority' | 'onLoad' | 'onError'> & {
  /** Eager-load with high fetch priority for above-the-fold posters. Never combined with lazy loading. */
  priority?: boolean;
  onError?: ImageProps['onError'];
};

// Srcs that finished loading at least once this session. Virtualized grids
// unmount/remount cards on scroll; without this, every remount restarted the
// fade from opacity 0 and cached posters visibly flickered back in.
const loadedSrcs = new Set<string>();

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
  const srcKey = typeof props.src === 'string' ? props.src : null;
  const [loaded, setLoaded] = useState(() => (srcKey ? loadedSrcs.has(srcKey) : false));
  // Keyed by src so a prop change to a new URL automatically retries instead
  // of staying hidden.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = srcKey !== null && failedSrc === srcKey;
  const markLoaded = useCallback(() => {
    if (srcKey) loadedSrcs.add(srcKey);
    setLoaded(true);
  }, [srcKey]);
  const imageRef = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete) markLoaded();
  }, [markLoaded]);

  // A broken src must not fade in as a broken-image glyph — drop the <img>
  // (the container's background shows through) and let the consumer's
  // onError swap in its own fallback.
  if (failed) return null;

  return (
    <Image
      {...props}
      ref={imageRef}
      alt={alt}
      priority={priority}
      loading={priority ? undefined : 'lazy'}
      onLoad={markLoaded}
      onError={(event) => {
        if (srcKey) setFailedSrc(srcKey);
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
