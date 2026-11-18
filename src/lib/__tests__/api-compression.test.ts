import { describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  redact: (value: unknown) => value,
}));

import { withApiLogging } from '@/lib/api-logger';
import { etagJson } from '@/lib/etag-json';

const big = { items: Array.from({ length: 200 }, (_, id) => ({ id, title: `Movie ${id}` })) };

// A route is handed the request even when it ignores it.
const route = (handler: () => Promise<Response>) => withApiLogging<(request: Request) => Promise<Response>>(handler);

function get(acceptEncoding?: string, extra: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/radarr', {
    headers: { ...(acceptEncoding ? { 'Accept-Encoding': acceptEncoding } : {}), ...extra },
  });
}

// Next (16.4.6 and later) compresses route handler responses itself, and drops
// a Content-Encoding a handler sets (send-response.js, FORBIDDEN_HEADERS). A
// body gzipped here reached the browser gzipped twice under one gzip header,
// and every library, movie and dashboard read failed to parse. So the wrapper
// must hand Next the plain body, whatever the client accepts.
describe('API JSON is left for Next to compress', () => {
  it('returns plain JSON with no Content-Encoding, even when the client accepts gzip', async () => {
    const handler = route(async () => NextResponse.json(big, { headers: { 'Set-Cookie': 'a=1' } }));

    const response = await handler(get('gzip, deflate, br'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(response.headers.getSetCookie()).toEqual(['a=1']);
    expect(await response.json()).toEqual(big);
  });

  it('still answers 304 to the ETag it sent', async () => {
    const handler = withApiLogging(async (request: Request) => etagJson(request, big, { 'Cache-Control': 'private, no-cache' }));
    const first = await handler(get('gzip'));
    const etag = first.headers.get('ETag')!;
    expect(etag).toBeTruthy();
    expect(first.headers.get('Content-Encoding')).toBeNull();

    expect((await handler(get('gzip', { 'If-None-Match': etag }))).status).toBe(304);
    expect((await handler(get(undefined, { 'If-None-Match': etag }))).status).toBe(304);
  });
});
