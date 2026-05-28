import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

/**
 * Receives the POST from the Web Share Target action declared in
 * `manifest.json`. The Android Chrome flow POSTs multipart/form-data;
 * iOS Shortcuts and manual URL flows GET with query params. Either way,
 * we forward to `/share` for the resolution UI.
 *
 * We don't resolve here — that happens server-side on the /share page —
 * because /share is auth-gated by middleware and can render rich UI on
 * the result, whereas this route just exists to satisfy the manifest
 * spec (which insists on POST for the share-target action).
 */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) {
    // Preserve the shared payload across the login round-trip so the user
    // doesn't lose context: send them to /login?next=/share?...
    const fallback = await readSharedParams(request);
    const next = `/share?${fallback.toString()}`;
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, request.url));
  }

  const params = await readSharedParams(request);
  return NextResponse.redirect(new URL(`/share?${params.toString()}`, request.url), 303);
}

async function readSharedParams(request: NextRequest): Promise<URLSearchParams> {
  const params = new URLSearchParams();
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    try {
      const form = await request.formData();
      const title = form.get('title');
      const text = form.get('text');
      const url = form.get('url');
      if (typeof title === 'string' && title) params.set('title', title);
      if (typeof text === 'string' && text) params.set('text', text);
      if (typeof url === 'string' && url) params.set('url', url);
    } catch {
      // Fall through — empty params results in unknown-share UI
    }
  } else if (contentType.includes('application/json')) {
    try {
      const body = (await request.json()) as { title?: string; text?: string; url?: string };
      if (body.title) params.set('title', body.title);
      if (body.text) params.set('text', body.text);
      if (body.url) params.set('url', body.url);
    } catch {
      // Fall through
    }
  }

  return params;
}

export const POST = withApiLogging(postHandler, 'api/share');
