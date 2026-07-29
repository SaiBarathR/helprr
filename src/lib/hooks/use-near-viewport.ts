'use client';

import { useEffect, useRef, useState } from 'react';

export const WIDGET_PREFETCH_ROOT_MARGIN = '600px 0px';

export function useNearViewport<T extends Element>(
  rootMargin = WIDGET_PREFETCH_ROOT_MARGIN,
): {
  ref: React.RefObject<T | null>;
  isNearViewport: boolean;
  hasEnteredViewport: boolean;
} {
  const ref = useRef<T | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      // Unsupported browsers should retain the pre-optimization behavior.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsNearViewport(true);
      setHasEnteredViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        const nearViewport = entry?.isIntersecting === true;
        setIsNearViewport(nearViewport);
        if (nearViewport) setHasEnteredViewport(true);
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, isNearViewport, hasEnteredViewport };
}
