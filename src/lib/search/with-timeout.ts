/**
 * Resolve to `fallback` if `p` doesn't settle within `ms`. Settles exactly once and
 * never rejects — a slow OR rejecting promise yields `fallback`, so callers (the
 * search route's per-module loads, the index builder's per-instance fetches) are never
 * blocked or thrown by one bad source.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    const settle = (v: T) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => settle(fallback), ms);
    p.then(settle, () => settle(fallback));
  });
}
