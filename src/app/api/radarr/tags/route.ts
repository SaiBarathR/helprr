import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { RadarrClient } from '@/lib/radarr-client';
import { resolveConnection } from '@/lib/arr-instances';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { REFERENCE_CACHE_HEADERS } from '@/lib/cache/reference-headers';
import { invalidateReferenceLabels } from '@/lib/cache/reference-labels';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const tags = await client.getTags();
    return NextResponse.json(tags, { headers: REFERENCE_CACHE_HEADERS });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch tags');
  }
}

// Create a tag on the spot from the add/edit forms. Gated by movies.view — the same
// bar the edit page clears (movie PUT only needs movies.view), so edit-only users
// aren't blocked.
async function postHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('movies.view');
  if (capError) return capError;

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const body = (await request.json().catch(() => null)) as { label?: unknown } | null;
    const label = typeof body?.label === 'string' ? body.label.trim() : '';
    if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });

    // Resolve the connection once so we can reuse its id for cache invalidation without a
    // second lookup — and so the only throwing call (the DB resolve) runs before any write.
    const conn = await resolveConnection('RADARR', instanceId);
    const client = new RadarrClient(conn.url, conn.apiKey);
    // Dedup case-insensitively (mirrors resolveTagIds in bulk-editor.ts) so we never
    // create a duplicate and always hand back a real {id,label}.
    const existing = await client.getTags();
    const match = existing.find((t) => t.label.toLowerCase() === label.toLowerCase());
    const tag = match ?? (await client.createTag(label));
    // A newly created tag isn't in the cached label map yet — drop it (best-effort) so the
    // list re-resolves the name instead of rendering a blank chip until the 120s TTL expires.
    if (!match) await invalidateReferenceLabels('radarr', conn.id);
    return NextResponse.json(tag);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to create tag');
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/tags');
export const POST = withApiLogging(postHandler, 'api/radarr/tags');
