export function logApiDuration(route: string, startedAtMs: number, metadata?: Record<string, unknown>) {
  const durationMs = Math.max(0, performance.now() - startedAtMs);
  if (metadata && Object.keys(metadata).length > 0) {
    console.info(`[perf][api] ${route} ${durationMs.toFixed(1)}ms`, metadata);
    return;
  }

  console.info(`[perf][api] ${route} ${durationMs.toFixed(1)}ms`);
}
