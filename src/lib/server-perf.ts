import { AsyncLocalStorage } from 'node:async_hooks';

type Span = { name: string; duration: number };
const scope = new AsyncLocalStorage<Span[]>();
const enabled = () => process.env.HELPRR_PERF === '1';

/** Fixed operation names only: never include identities, URLs or payloads. */
export async function measureServer<T>(name: 'auth' | 'session' | 'cache' | 'upstream' | 'projection' | 'serialization', operation: () => Promise<T>): Promise<T> {
  const spans = scope.getStore();
  if (!spans) return operation();
  const start = performance.now();
  try { return await operation(); }
  finally { if (spans.length < 128) spans.push({ name, duration: performance.now() - start }); }
}

export async function withPerformanceScope<T extends Response>(operation: () => Promise<T> | T): Promise<T> {
  if (!enabled()) return operation();
  const spans: Span[] = [];
  return scope.run(spans, async () => {
    const start = performance.now();
    const response = await operation();
    const totals = new Map<string, { duration: number; count: number }>();
    for (const span of spans) {
      const total = totals.get(span.name) ?? { duration: 0, count: 0 };
      total.duration += span.duration; total.count++;
      totals.set(span.name, total);
    }
    response.headers.set('Server-Timing', [`total;dur=${(performance.now() - start).toFixed(1)}`, ...[...totals].map(([name, total]) => `${name};dur=${total.duration.toFixed(1)};desc="${total.count} calls"`)].join(', '));
    return response;
  });
}

export function logApiDuration(route: string, startedAtMs: number, metadata?: Record<string, unknown>) {
  if (!enabled()) return;
  // Existing callers supply route templates and numeric/cache metadata only.
  console.info(`[perf][api] ${route} ${Math.max(0, performance.now() - startedAtMs).toFixed(1)}ms`, metadata ?? {});
}
