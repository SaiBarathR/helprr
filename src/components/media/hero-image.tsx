'use client';

import Image, { type ImageProps } from 'next/image';
import { useState } from 'react';

/**
 * A hero backdrop that renders nothing once its source fails to load, so the
 * hero's own background shows instead of the browser's broken-image glyph and
 * the title as alt text. A different source (the next slide) tries again.
 */
export function HeroImage(props: ImageProps) {
  const [failedSrc, setFailedSrc] = useState<ImageProps['src'] | null>(null);
  if (failedSrc === props.src) return null;
  return (
    <Image
      {...props}
      alt={props.alt}
      onError={(event) => {
        setFailedSrc(props.src);
        props.onError?.(event);
      }}
    />
  );
}
