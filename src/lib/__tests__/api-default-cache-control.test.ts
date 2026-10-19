import { describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  redact: (value: unknown) => value,
}));

import { configureApiLogging, withApiLogging } from '@/lib/api-logger';
import { cacheBrowseSnapshot } from '@/lib/offline-snapshot';

// Per-user API answers must not be stored by the browser or a proxy unless the
// route chooses a policy itself.
describe('default Cache-Control on API responses', () => {
  for (const enabled of [true, false]) {
    it(`marks a response without one private, no-store (logging ${enabled ? 'on' : 'off'})`, async () => {
      configureApiLogging({ enabled, failedRequestBodies: false, failedResponseBodies: false });
      const handler = withApiLogging(async () => NextResponse.json({ ok: true }));

      expect((await handler()).headers.get('Cache-Control')).toBe('private, no-store');
    });
  }

  it("keeps a route's own policy", async () => {
    const handler = withApiLogging(async () => NextResponse.json({}, { headers: { 'Cache-Control': 'public, max-age=86400, immutable' } }));

    expect((await handler()).headers.get('Cache-Control')).toBe('public, max-age=86400, immutable');
  });

  it('marks the 500 answer for a handler that threw', async () => {
    const handler = withApiLogging(async (): Promise<Response> => { throw new Error('boom'); });

    const response = await handler();
    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('keeps the reads the service worker snapshots storable, revalidated on every use', async () => {
    const handler = withApiLogging(async (request: Request) => NextResponse.json({ path: new URL(request.url).pathname }));

    const watchlist = await handler(new Request('http://localhost/api/watchlist'));
    expect(watchlist.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(await cacheBrowseSnapshot(watchlist)).not.toBeNull();

    const me = await handler(new Request('http://localhost/api/me'));
    expect(me.headers.get('Cache-Control')).toBe('private, no-store');
    const post = await handler(new Request('http://localhost/api/watchlist', { method: 'POST' }));
    expect(post.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
