import { createHash } from 'crypto';
import { NextResponse } from 'next/server';

/**
 * Headers for a JSON answer that may be revalidated. Next compresses the 200
 * (gzip for a client that accepts it, the same bytes otherwise) and keeps the
 * ETag, so the tag is weak: one tag for both encodings. Next adds
 * `Vary: Accept-Encoding` to the compressed 200 only, so a bodyless 304 would
 * replace a cache's stored Vary without it; it is set on both here.
 */
export function conditionalJsonHeaders(headers: Record<string, string>, etag: string): Record<string, string> {
  const rest: Record<string, string> = {};
  let vary: string | undefined;
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === 'vary') vary = value;
    else if (lower !== 'etag') rest[name] = value;
  }
  const withEncoding = !vary
    ? 'Accept-Encoding'
    : /(^|,)\s*(accept-encoding|\*)\s*(,|$)/i.test(vary) ? vary : `${vary}, Accept-Encoding`;
  return { ...rest, Vary: withEncoding, ETag: `W/${etag}` };
}

// Conditional JSON response: an ETag over the serialized payload lets the
// browser revalidate `private, no-cache` responses with If-None-Match, so an
// unchanged library list costs a 304 instead of re-downloading the full JSON —
// the dominant repeat-transfer on mobile data.
export function etagJson(
  request: { headers: Headers },
  payload: unknown,
  headers: Record<string, string>,
): NextResponse {
  const body = JSON.stringify(payload);
  const etag = `"${createHash('sha1').update(body).digest('hex')}"`;

  const ifNoneMatch = request.headers.get('if-none-match');
  const matches = ifNoneMatch
    ?.split(',')
    .some((candidate) => candidate.trim().replace(/^W\//, '') === etag);
  if (matches) {
    return new NextResponse(null, { status: 304, headers: conditionalJsonHeaders(headers, etag) });
  }

  return new NextResponse(body, {
    status: 200,
    headers: { ...conditionalJsonHeaders(headers, etag), 'Content-Type': 'application/json' },
  });
}
