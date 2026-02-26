'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

const PENDING_TIMEOUT_MS = 15000;

export function useNavPending() {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const clearPending = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setPendingHref(null);
  }, []);

  const beginPending = useCallback(
    (href: string) => {
      if (href === pathname) {
        return;
      }

      startedAtRef.current = performance.now();
      setPendingHref(href);

      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = window.setTimeout(() => {
        clearPending();
      }, PENDING_TIMEOUT_MS);
    },
    [clearPending, pathname]
  );

  useEffect(() => {
    if (!pendingHref) return;

    const routeCommitted = pathname === pendingHref || pathname.startsWith(pendingHref + '/');
    if (!routeCommitted) return;

    if (startedAtRef.current !== null) {
      const durationMs = performance.now() - startedAtRef.current;
      console.info(`[perf][nav] ${pendingHref} -> ${pathname} ${durationMs.toFixed(1)}ms`);
    }

    const timerId = window.setTimeout(() => {
      startedAtRef.current = null;
      clearPending();
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [clearPending, pathname, pendingHref]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    pendingHref,
    beginPending,
  };
}
