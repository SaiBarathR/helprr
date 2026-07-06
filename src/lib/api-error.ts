import { isAxiosError } from 'axios';
import { NextResponse } from 'next/server';

// Intentional, user-facing configuration guidance thrown by service-helpers
// ("X is not configured. Please add a X connection in Settings."). It contains
// no upstream detail and the settings UI relies on seeing it verbatim.
const SAFE_CONFIG_MESSAGE_RE = /is not configured|context is missing/;

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

  if (error instanceof Error && SAFE_CONFIG_MESSAGE_RE.test(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ error: fallback }, { status: 500 });
}
