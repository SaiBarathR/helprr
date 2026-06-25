import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { resolveConnection } from '@/lib/arr-instances';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { REFERENCE_CACHE_HEADERS } from '@/lib/cache/reference-headers';
import { invalidateReferenceLabels } from '@/lib/cache/reference-labels';

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const tags = await client.getTags();
    return NextResponse.json(tags, { headers: REFERENCE_CACHE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch tags';
    return NextResponse.json({ error: message }, { status: 500 });
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

    const client = await getRadarrClient(instanceId);
    // Dedup case-insensitively (mirrors resolveTagIds in bulk-editor.ts) so we never
    // create a duplicate and always hand back a real {id,label}.
    const existing = await client.getTags();
    const match = existing.find((t) => t.label.toLowerCase() === label.toLowerCase());
    const tag = match ?? (await client.createTag(label));
    // A newly created tag isn't in the cached label map yet — drop it so the list re-resolves
    // the tag's name instead of rendering a blank chip until the 120s TTL expires.
    if (!match) {
      const conn = await resolveConnection('RADARR', instanceId);
      await invalidateReferenceLabels('radarr', conn.id);
    }
    return NextResponse.json(tag);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create tag';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/tags');
export const POST = withApiLogging(postHandler, 'api/radarr/tags');
