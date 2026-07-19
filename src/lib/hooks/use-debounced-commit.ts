'use client';

import { useCallback, useEffect, useRef } from 'react';

export type CommitReason = 'timer' | 'flush' | 'unmount';

/**
 * Debounce core, framework-free so it can be unit-tested with fake timers.
 * Exactly one commit runs per pending value; `flush` commits early instead of
 * discarding, which is the difference from the search-style debounces in the
 * repo (those intentionally drop pending work on cleanup — never safe for
 * persistence).
 */
export function createDebouncedCommit<T>(
  commit: (value: T, reason: CommitReason) => void,
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
    commit(value, reason);
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
    cancel() {
      pending = null;
      clear();
    },
  };
}

/**
 * Debounced auto-save that cannot drop edits: the pending value is committed
 * (not cancelled) when the component unmounts, so a quick back-nav still
 * persists the last edit. The commit receives the trigger reason so callers
 * can e.g. skip validation toasts when committing during unmount.
 *
 * The commit callback is kept in a ref — it may close over fresh state
 * without retriggering timers.
 */
export function useDebouncedCommit<T>(
  commit: (value: T, reason: CommitReason) => void,
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
    coreRef.current ??= createDebouncedCommit<T>((value, reason) => {
      commitRef.current(value, reason);
    }, delayMs);
    return coreRef.current;
  }, [delayMs]);

  useEffect(() => {
    return () => coreRef.current?.unmount();
  }, []);

  return {
    schedule: useCallback((value: T) => getCore().schedule(value), [getCore]),
    flush: useCallback(() => getCore().flush(), [getCore]),
    cancel: useCallback(() => getCore().cancel(), [getCore]),
  };
}
