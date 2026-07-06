import { isAxiosError } from 'axios';
import { NextResponse } from 'next/server';
import { ConfigurationError } from '@/lib/config-error';

/**
 * Convert a caught error into a client-safe JSON response. Upstream failures
 * (Axios network errors) carry internal detail like
 * `connect ECONNREFUSED 192.168.1.10:8989`, so the raw message is logged
 * server-side and never echoed to the client. An upstream 404 maps to a 404
 * instead of a 500 so a nonexistent id isn't reported as a server error.
 */
export function upstreamErrorResponse(error: unknown, fallback: string): NextResponse {
  console.error(`[api] ${fallback}:`, error instanceof Error ? error.message : error);

  if (isAxiosError(error) && error.response?.status === 404) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Intentional, user-facing configuration guidance — contains no upstream
  // detail and the settings UI relies on seeing it verbatim.
  if (error instanceof ConfigurationError) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ error: fallback }, { status: 500 });
}
