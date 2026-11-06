import { gunzipSync, gzipSync } from 'node:zlib';
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

// Next skips its own compression for route handlers, so a client reaching
// Helprr directly (LAN, Tailscale) got library JSON uncompressed.
describe('API JSON compression', () => {
  it('gzips JSON of at least 1 KB when the client accepts gzip', async () => {
    const handler = route(async () => NextResponse.json(big, { headers: { 'Set-Cookie': 'a=1' } }));

    const response = await handler(get('gzip, deflate, br'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Encoding')).toBe('gzip');
    expect(response.headers.get('Content-Length')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Accept-Encoding');
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(response.headers.getSetCookie()).toEqual(['a=1']);
    const body = gunzipSync(Buffer.from(await response.arrayBuffer())).toString();
    expect(JSON.parse(body)).toEqual(big);
  });

  it('sends identity when gzip is not accepted', async () => {
    const handler = route(async () => NextResponse.json(big));

    for (const accept of [undefined, 'br', 'identity', 'gzip;q=0', '*;q=0', 'gzip;q=0, *']) {
      const response = await handler(get(accept));
      expect(response.headers.get('Content-Encoding'), String(accept)).toBeNull();
      expect(response.headers.get('Vary')).toBe('Accept-Encoding');
      expect(await response.json()).toEqual(big);
    }
  });

  it('accepts gzip through q-values and the wildcard', async () => {
    const handler = route(async () => NextResponse.json(big));

    for (const accept of ['GZIP;q=0.5', '*', 'br;q=1, *;q=0.1', 'x-gzip']) {
      expect((await handler(get(accept))).headers.get('Content-Encoding'), accept).toBe('gzip');
    }
    const withCharset = route(async () => new Response(JSON.stringify(big), { headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
    expect((await withCharset(get('gzip'))).headers.get('Content-Encoding')).toBe('gzip');
  });

  it('leaves a body under 1 KB uncompressed', async () => {
    const handler = route(async () => NextResponse.json({ ok: true }, { status: 201 }));

    const response = await handler(get('gzip'));

    expect(response.status).toBe(201);
    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(await response.json()).toEqual({ ok: true });
  });

  it('does not compress a body already encoded', async () => {
    const encoded = gzipSync(JSON.stringify(big));
    const handler = route(async () => new Response(encoded, {
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
    }));

    const response = await handler(get('gzip'));

    expect(response.headers.get('Content-Encoding')).toBe('gzip');
    expect(Buffer.from(await response.arrayBuffer()).equals(encoded)).toBe(true);
  });

  it('passes streams and non-JSON bodies through untouched', async () => {
    const bodies: Array<[string, () => Response]> = [
      ['ndjson stream', () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('x'.repeat(4096)));
          controller.close();
        },
      }), { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } })],
      ['event stream', () => new Response('data: x\n\n'.repeat(500), { headers: { 'Content-Type': 'text/event-stream' } })],
      ['image', () => new Response(new Uint8Array(4096), { headers: { 'Content-Type': 'image/jpeg' } })],
    ];
    for (const [name, make] of bodies) {
      const original = make();
      const handler = route(async () => original);
      const response = await handler(get('gzip'));
      expect(response, name).toBe(original);
      expect(response.headers.get('Content-Encoding'), name).toBeNull();
      expect(response.headers.get('Vary'), name).toBeNull();
    }
  });

  it('leaves 204 and HEAD answers alone', async () => {
    const noContent = route(async () => new NextResponse(null, { status: 204 }));
    expect((await noContent(get('gzip'))).headers.get('Content-Encoding')).toBeNull();

    const head = route(async () => NextResponse.json(big));
    const headResponse = await head(new Request('http://localhost/api/radarr', { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip' } }));
    expect(headResponse.headers.get('Content-Encoding')).toBeNull();
  });

  it('weakens the ETag of a gzipped body and still answers 304 to it', async () => {
    const handler = withApiLogging(async (request: Request) => etagJson(request, big, { 'Cache-Control': 'private, no-cache' }));

    const first = await handler(get('gzip'));
    const etag = first.headers.get('ETag')!;
    expect(first.headers.get('Content-Encoding')).toBe('gzip');
    expect(etag).toMatch(/^W\/"[0-9a-f]{40}"$/);

    const second = await handler(get('gzip', { 'If-None-Match': etag }));
    expect(second.status).toBe(304);
    expect(second.headers.get('Content-Encoding')).toBeNull();
    expect(await second.text()).toBe('');

    // The identity body keeps its strong validator, and either form revalidates.
    const identity = await handler(get(undefined));
    expect(identity.headers.get('ETag')).toBe(etag.slice(2));
    expect((await handler(get(undefined, { 'If-None-Match': etag }))).status).toBe(304);
  });

  it('keeps a route Vary and an already weak ETag', async () => {
    const handler = route(async () => NextResponse.json(big, { headers: { Vary: 'Cookie', ETag: 'W/"v1"' } }));

    const response = await handler(get('gzip'));

    expect(response.headers.get('Vary')).toBe('Cookie, Accept-Encoding');
    expect(response.headers.get('ETag')).toBe('W/"v1"');
  });
});
