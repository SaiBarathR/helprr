import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { LidarrClient } from '@/lib/lidarr-client';
import { resolveConnection } from '@/lib/arr-instances';
import { getConnectionHeaders } from '@/lib/service-connection-secrets';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { REFERENCE_CACHE_HEADERS } from '@/lib/cache/reference-headers';
import { invalidateReferenceLabels } from '@/lib/cache/reference-labels';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('music.view');
  if (capError) return capError;

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);
    const tags = await client.getTags();
    return NextResponse.json(tags, { headers: REFERENCE_CACHE_HEADERS });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch tags');
  }
}

// Create a tag on the spot from the add/edit forms. Gated by music.view — the same
// bar the edit page clears (artist PUT only needs music.view), so edit-only users
// aren't blocked.
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('music.view');
  if (capError) return capError;

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const body = (await request.json().catch(() => null)) as { label?: unknown } | null;
    const label = typeof body?.label === 'string' ? body.label.trim() : '';
    if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });

    // Resolve the connection once so we can reuse its id for cache invalidation without a
    // second lookup — and so the only throwing call (the DB resolve) runs before any write.
    const conn = await resolveConnection('LIDARR', instanceId);
    const client = new LidarrClient(conn.url, conn.apiKey, getConnectionHeaders(conn));
    // Dedup case-insensitively (mirrors resolveTagIds in bulk-editor.ts) so we never
    // create a duplicate and always hand back a real {id,label}.
    const existing = await client.getTags();
    const match = existing.find((t) => t.label.toLowerCase() === label.toLowerCase());
    const tag = match ?? (await client.createTag(label));
    // A newly created tag isn't in the cached label map yet — drop it (best-effort) so the
    // list re-resolves the name instead of rendering a blank chip until the 120s TTL expires.
    if (!match) await invalidateReferenceLabels('lidarr', conn.id);
    return NextResponse.json(tag);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to create tag');
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/tags');
export const POST = withApiLogging(postHandler, 'api/lidarr/tags');
