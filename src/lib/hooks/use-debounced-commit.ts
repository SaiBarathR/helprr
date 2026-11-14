'use client';

import { useCallback, useEffect, useRef } from 'react';

/** `pagehide`: the document is going away or into the background (a reload,
 *  a Back that leaves it, an app switch), so the commit must start its request
 *  right now and with `keepalive`, or the browser drops it. */
export type CommitReason = 'timer' | 'flush' | 'unmount' | 'pagehide';

/**
 * Debounce core, framework-free so it can be unit-tested with fake timers.
 * Exactly one commit runs per pending value; `flush` commits early instead of
 * discarding, which is the difference from the search-style debounces in the
 * repo (those intentionally drop pending work on cleanup — never safe for
 * persistence).
 */
export function createDebouncedCommit<T>(
  commit: (value: T, reason: CommitReason) => void | false,
  delayMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const run = (reason: CommitReason) => {
    if (!pending) return;
    const { value } = pending;
    pending = null;
    clear();
    // `false`: not now (an invalid draft as the page hides but may live on):
    // keep it pending, and run it again once the timer can fire.
    if (commit(value, reason) === false) {
      pending = { value };
      timer = setTimeout(() => run('timer'), delayMs);
    }
  };

  return {
    schedule(value: T) {
      pending = { value };
      clear();
      timer = setTimeout(() => run('timer'), delayMs);
    },
    flush() {
      run('flush');
    },
    unmount() {
      run('unmount');
    },
    pagehide() {
      run('pagehide');
    },
    cancel() {
      pending = null;
      clear();
    },
  };
}

/**
 * Debounced auto-save that cannot drop edits: the pending value is committed
 * (not cancelled) when the component unmounts, so a quick back-nav still
 * persists the last edit, and when the page hides (reason `pagehide`), since
 * a reload or a Back that leaves the document never unmounts anything. The
 * commit receives the trigger reason so callers can e.g. skip validation
 * toasts when committing during unmount.
 *
 * The commit callback is kept in a ref — it may close over fresh state
 * without retriggering timers.
 */
export function useDebouncedCommit<T>(
  commit: (value: T, reason: CommitReason) => void | false,
  delayMs: number,
) {
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });

  // One core per component instance, created lazily from event handlers /
  // effects only (never during render, per react-hooks/refs).
  const coreRef = useRef<ReturnType<typeof createDebouncedCommit<T>> | null>(null);
  const getCore = useCallback(() => {
    coreRef.current ??= createDebouncedCommit<T>((value, reason) => commitRef.current(value, reason), delayMs);
    return coreRef.current;
  }, [delayMs]);

  useEffect(() => {
    const onHide = () => coreRef.current?.pagehide();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide();
    };
    // pagehide for unloads; visibilitychange for an iOS PWA swiped away or
    // backgrounded, which may never get a pagehide.
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      coreRef.current?.unmount();
    };
  }, []);

  return {
    schedule: useCallback((value: T) => getCore().schedule(value), [getCore]),
    flush: useCallback(() => getCore().flush(), [getCore]),
    cancel: useCallback(() => getCore().cancel(), [getCore]),
  };
}
