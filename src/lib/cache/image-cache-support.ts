import type { ImageCacheDiagnostics } from '@/lib/cache/image-cache-accounting';

export function imageCacheHealthLabel(diagnostics: ImageCacheDiagnostics): string {
  if (!diagnostics.accountingAvailable || diagnostics.health === 'accounting-unavailable') {
    return 'Accounting unavailable';
  }
  if (diagnostics.health === 'degraded-storage') return 'Degraded storage';
  if (diagnostics.health === 'revalidating') return 'Revalidating';
  return 'Healthy';
}

/**
 * Deliberately excludes lastHost, filesystem paths, cache keys, URLs, request
 * identities, and observation strings that could grow sensitive over time.
 */
export function toSafeImageCacheDiagnostics(diagnostics: ImageCacheDiagnostics) {
  return {
    health: imageCacheHealthLabel(diagnostics),
    accountingAvailable: diagnostics.accountingAvailable,
    quota: {
      bytes: diagnostics.quotaBytes,
      maxBytes: diagnostics.maxBytes,
      entries: diagnostics.quotaEntries,
      maxEntries: diagnostics.maxEntries,
    },
    processing: {
      queued: diagnostics.queueDepth,
      running: diagnostics.currentRunning,
      maxQueued: diagnostics.maxQueueDepth,
      maxRunning: diagnostics.maxRunning,
      queueWaitLimitMs: diagnostics.queueWaitLimitMs,
      queueWaitP50Ms: diagnostics.queueWaitP50Ms,
      queueWaitP95Ms: diagnostics.queueWaitP95Ms,
      queueWaitMaxMs: diagnostics.queueWaitMaxMs,
    },
    cache: {
      hits: diagnostics.cacheHits,
      stale: diagnostics.staleResponses,
      misses: diagnostics.trueMisses,
      registrations: diagnostics.registrations,
      bypasses: diagnostics.cacheBypasses,
      healthyBypasses: diagnostics.healthyBypasses,
      evictions: diagnostics.evictions,
      missingFileRecoveries: diagnostics.missingFileRecoveries,
    },
    failures: {
      queueCapacity: diagnostics.queueCapacityRejections,
      rateLimit: diagnostics.rateLimitRejections,
      clientAborts: diagnostics.clientAborts,
      upstreamTimeouts: diagnostics.upstreamTimeouts,
      upstreamErrors: diagnostics.upstreamErrors,
      quotaLockWaits: diagnostics.quotaLockWaits,
      quotaLockTimeouts: diagnostics.quotaLockTimeouts,
      oversized: diagnostics.oversizedRejections,
      invalidImages: diagnostics.invalidImageRejections,
    },
    backgroundRevalidation: {
      started: diagnostics.backgroundRevalidationsStarted,
      succeeded: diagnostics.backgroundRevalidationsSucceeded,
      failed: diagnostics.backgroundRevalidationsFailed,
    },
    rateBounds: {
      burst: diagnostics.rateBurst,
      refillPerMinute: diagnostics.rateRefillPerMinute,
    },
  };
}

export type SafeImageCacheDiagnostics = ReturnType<typeof toSafeImageCacheDiagnostics>;
