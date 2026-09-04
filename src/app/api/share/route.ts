import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import {
  BoundedBodyError,
  boundedBodyErrorResponse,
  readBoundedFormData,
} from '@/lib/server/bounded-body';

const SHARE_BODY_MAX_BYTES = 16 * 1024;
const SHARE_TITLE_MAX_CODE_POINTS = 256;
const SHARE_TEXT_MAX_BYTES = 2_048;
const SHARE_URL_MAX_BYTES = 2_048;
const SHARE_REDIRECT_QUERY_MAX_BYTES = 8 * 1024;
const SHARE_REDIRECT_LOCATION_MAX_BYTES = 8 * 1024;

/**
 * 303 to a *relative* Location.
 *
 * The obvious `new URL(target, request.url)` is wrong here. In a standalone
 * build `request.url` carries the server's own bind address rather than the
 * host that was asked, so a link shared into the installed Android PWA
 * redirected to `http://0.0.0.0:3050/login`: the payload survived intact and
 * the user landed on an unreachable host. Reading `x-forwarded-host` would
 * fix the host but makes the Location a caller-supplied value. A relative
 * reference is resolved by the browser against the origin it actually
 * requested, so it is same-origin by construction and needs no proxy headers
 * at all -- which is how middleware already emits its own /login redirects.
 */
function redirectOrPayloadTooLarge(target: string): NextResponse {
  if (Buffer.byteLength(target, 'utf8') > SHARE_REDIRECT_LOCATION_MAX_BYTES) {
    return NextResponse.json(
      { error: 'Shared payload is too large' },
      { status: 413 },
    );
  }
  return new NextResponse(null, { status: 303, headers: { location: target } });
}

/**
 * Receives the POST from the Web Share Target action declared in
 * `manifest.json` (which is fixed to `method: POST`, `enctype:
 * multipart/form-data`). We read the shared fields and forward to `/share`
 * for the resolution UI. iOS Shortcuts and manual URL flows don't hit this
 * route — they go to `/protocol` or `/share` directly with query params.
 *
 * We don't resolve here — that happens server-side on the /share page —
 * because /share is auth-gated by middleware and can render rich UI on
 * the result, whereas this route just exists to satisfy the manifest
 * spec (which insists on POST for the share-target action).
 */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  let params: URLSearchParams;
  try {
    params = await readSharedParams(request);
  } catch (error) {
    const response = boundedBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }

  const query = params.toString();
  if (Buffer.byteLength(query, 'utf8') > SHARE_REDIRECT_QUERY_MAX_BYTES) {
    return NextResponse.json(
      { error: 'Shared payload is too large' },
      { status: 413 },
    );
  }

  const authError = await requireAuth();
  if (authError) {
    // Preserve the shared payload across the login round-trip so the user
    // doesn't lose context: send them to /login?next=/share?...
    const next = `/share?${query}`;
    return redirectOrPayloadTooLarge(`/login?next=${encodeURIComponent(next)}`);
  }

  return redirectOrPayloadTooLarge(`/share?${query}`);
}

async function readSharedParams(request: NextRequest): Promise<URLSearchParams> {
  const form = await readBoundedFormData(request, SHARE_BODY_MAX_BYTES);
  const params = new URLSearchParams();
  const title = form.get('title');
  const text = form.get('text');
  const url = form.get('url');

  if (typeof title === 'string' && [...title].length > SHARE_TITLE_MAX_CODE_POINTS) {
    throw new BoundedBodyError(413, 'Shared payload is too large');
  }
  if (typeof text === 'string' && Buffer.byteLength(text, 'utf8') > SHARE_TEXT_MAX_BYTES) {
    throw new BoundedBodyError(413, 'Shared payload is too large');
  }
  if (typeof url === 'string' && Buffer.byteLength(url, 'utf8') > SHARE_URL_MAX_BYTES) {
    throw new BoundedBodyError(413, 'Shared payload is too large');
  }

  if (typeof title === 'string' && title) params.set('title', title);
  if (typeof text === 'string' && text) params.set('text', text);
  if (typeof url === 'string' && url) params.set('url', url);

  return params;
}

export const POST = withApiLogging(postHandler, 'api/share', { logBodies: false });
