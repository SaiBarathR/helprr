'use client';

import Image, { type ImageProps } from 'next/image';
import { ImageOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type FadeInImageProps = Omit<ImageProps, 'loading' | 'priority' | 'onLoad' | 'onError'> & {
  /** Eager-load with high fetch priority for above-the-fold posters. Never combined with lazy loading. */
  priority?: boolean;
  /** Invoked once, only after all retry attempts have failed. */
  onError?: ImageProps['onError'];
};

const RETRY_DELAYS_MS = [750, 2_000, 5_000] as const;
const RETRY_JITTER = 0.15;

// Srcs that finished loading at least once this session. Virtualized grids
// unmount/remount cards on scroll; without this, every remount restarted the
// fade from opacity 0 and cached posters visibly flickered back in.
const loadedSrcs = new Set<string>();

function imageSourceKey(src: ImageProps['src']): string {
  if (typeof src === 'string') return src;
  return 'src' in src ? src.src : src.default.src;
}

function jitteredDelay(delayMs: number): number {
  const factor = 1 - RETRY_JITTER + Math.random() * RETRY_JITTER * 2;
  return Math.max(0, Math.round(delayMs * factor));
}

function RetryableImage({
  priority = false,
  className,
  alt,
  onError,
  ...props
}: FadeInImageProps) {
  const srcKey = imageSourceKey(props.src);
  const [loaded, setLoaded] = useState(() => loadedSrcs.has(srcKey));
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const retryPendingRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onlineListenerRef = useRef<(() => void) | null>(null);

  const clearPendingRetry = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (onlineListenerRef.current) {
      window.removeEventListener('online', onlineListenerRef.current);
      onlineListenerRef.current = null;
    }
    retryPendingRef.current = false;
  }, []);

  useEffect(() => clearPendingRetry, [clearPendingRetry]);

  const markLoaded = useCallback(() => {
    clearPendingRetry();
    loadedSrcs.add(srcKey);
    setLoaded(true);
  }, [clearPendingRetry, srcKey]);

  const imageRef = useCallback((node: HTMLImageElement | null) => {
    // `complete` is also true for terminally broken images. Only decoded bytes
    // have a positive natural width and may enter the remount fast path.
    if (node?.complete && node.naturalWidth > 0) markLoaded();
  }, [markLoaded]);

  const advanceRetry = useCallback(() => {
    clearPendingRetry();
    setLoaded(false);
    setAttempt((current) => current + 1);
  }, [clearPendingRetry]);

  const scheduleRetry = useCallback(() => {
    if (retryPendingRef.current) return;
    retryPendingRef.current = true;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const resume = () => advanceRetry();
      onlineListenerRef.current = resume;
      window.addEventListener('online', resume, { once: true });
      return;
    }

    retryTimerRef.current = setTimeout(
      advanceRetry,
      jitteredDelay(RETRY_DELAYS_MS[attempt]!),
    );
  }, [advanceRetry, attempt]);

  if (failed) {
    // Consumers with a domain-specific fallback (MediaCard, for example) swap
    // it in through onError. Everyone else gets a neutral, truthful fallback.
    if (onError) return null;
    return (
      <span
        className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground"
        {...(alt
          ? { role: 'img', 'aria-label': `${alt} image unavailable` }
          : { 'aria-hidden': true })}
        data-image-fallback="true"
      >
        <ImageOff className="h-1/4 w-1/4 min-h-5 min-w-5 max-h-12 max-w-12" />
      </span>
    );
  }

  return (
    <>
      {!loaded && (
        <span
          aria-hidden="true"
          data-image-loading="true"
          className="absolute inset-0 bg-[length:200%_100%] bg-gradient-to-r from-muted via-muted/50 to-muted animate-[shimmer_1.5s_ease-in-out_infinite] motion-reduce:animate-none"
        />
      )}
      <Image
        {...props}
        key={`${srcKey}:${attempt}`}
        ref={imageRef}
        alt={alt}
        priority={priority}
        loading={priority ? undefined : 'lazy'}
        onLoad={markLoaded}
        onError={(event) => {
          setLoaded(false);
          if (attempt < RETRY_DELAYS_MS.length) {
            scheduleRetry();
            return;
          }
          clearPendingRetry();
          setFailed(true);
          onError?.(event);
        }}
        className={cn(
          'transition-opacity duration-300',
          loaded ? 'opacity-100' : 'opacity-0',
          className,
        )}
      />
    </>
  );
}

/**
 * Poster image with visible loading state, bounded same-URL retries, and a
 * built-in final fallback. Changing src remounts the retry state at attempt 0.
 */
export function FadeInImage(props: FadeInImageProps) {
  return <RetryableImage key={imageSourceKey(props.src)} {...props} />;
}
