import { NextResponse } from 'next/server';
import { AniListRateLimitError } from '@/lib/anilist-client';

/**
 * Map an AniList rate-limit error to an HTTP 429 with a Retry-After header so
 * the browser's network tab (and toasts reading `error`) show the real cause.
 * Returns null for any other error — callers fall through to their own mapping.
 */
export function anilistRateLimitResponse(error: unknown): NextResponse | null {
  if (!(error instanceof AniListRateLimitError)) return null;
  return NextResponse.json(
    {
      error: error.message,
      code: 'ANILIST_RATE_LIMIT',
      retryAfterSeconds: error.retryAfterSeconds,
      retryAt: error.retryAt,
    },
    { status: 429, headers: { 'Retry-After': String(error.retryAfterSeconds) } }
  );
}
