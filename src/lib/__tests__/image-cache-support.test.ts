import { describe, expect, it } from 'vitest';
import { unavailableImageCacheDiagnostics } from '@/lib/cache/image-cache-accounting';
import { toSafeImageCacheDiagnostics } from '@/lib/cache/image-cache-support';

describe('copy-safe image cache diagnostics', () => {
  it('keeps bounded counters while excluding host and observation details', () => {
    const diagnostics = {
      ...unavailableImageCacheDiagnostics(),
      lastHost: 'private-upstream.example.test',
      lastOutcome: 'source-specific-outcome',
      lastCacheStatus: 'MISS',
      lastDetectedFormat: 'jpeg',
      healthCheckedAt: '2026-08-25T00:00:00.000Z',
    };

    const safe = toSafeImageCacheDiagnostics(diagnostics);
    const serialized = JSON.stringify(safe);

    expect(safe).toMatchObject({
      health: 'Accounting unavailable',
      processing: { maxQueued: 256, maxRunning: 16 },
      rateBounds: { burst: 600, refillPerMinute: 300 },
    });
    expect(serialized).not.toContain('private-upstream');
    expect(serialized).not.toContain('source-specific');
    expect(serialized).not.toContain('healthCheckedAt');
  });
});
