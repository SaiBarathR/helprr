import { createHash } from 'crypto';
import { NextResponse } from 'next/server';

// Conditional JSON response: a strong ETag over the serialized payload lets the
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
    return new NextResponse(null, { status: 304, headers: { ...headers, ETag: etag } });
  }

  return new NextResponse(body, {
    status: 200,
    headers: { ...headers, ETag: etag, 'Content-Type': 'application/json' },
  });
}
