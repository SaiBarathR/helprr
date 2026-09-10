import { describe, expect, it } from 'vitest';
import { cacheBrowseSnapshot, staleBrowseSnapshot, SNAPSHOT_MAX_AGE_MS } from './offline-snapshot';
describe('browse snapshot provenance', () => {
  it('marks cached data with its original age without extending it on use', async () => {
    const cached = await cacheBrowseSnapshot(Response.json({ items: [] }), 1000);
    const stale = staleBrowseSnapshot(cached!, 2000)!;
    expect(stale.headers.get('x-helprr-stale')).toBe('1');
    expect(stale.headers.get('x-helprr-snapshot-at')).toBe('1000');
    expect(staleBrowseSnapshot(stale, 1001 + SNAPSHOT_MAX_AGE_MS)).toBeNull();
  });
  it('rejects old-worker, auth-error, private no-store and oversized snapshots', async () => {
    expect(staleBrowseSnapshot(Response.json([]))).toBeNull();
    expect(await cacheBrowseSnapshot(Response.json({}, { status: 403 }))).toBeNull();
    expect(await cacheBrowseSnapshot(Response.json({}, { headers: { 'cache-control': 'no-store' } }))).toBeNull();
    expect(await cacheBrowseSnapshot(Response.json('x'.repeat(2 * 1024 * 1024)))).toBeNull();
  });
});
