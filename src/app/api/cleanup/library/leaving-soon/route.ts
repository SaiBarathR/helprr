import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { isLibraryMediaType } from '@/lib/library-cleanup/config';
import { markLeavingSoon, MAX_MARK_ITEMS } from '@/lib/library-cleanup/service';
import { libraryCleanupErrorResponse, readJsonObject } from '../_shared';

const KEY_PATTERN = /^(RADARR|SONARR):[^:]{1,64}:[1-9][0-9]{0,9}$/;

// Marks titles Leaving soon. Each is re-evaluated from fresh data first.
async function postHandler(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await readJsonObject(req);
  if (!body || !isLibraryMediaType(body.mediaType)) {
    return NextResponse.json({ error: 'mediaType must be "movie" or "series"' }, { status: 400 });
  }
  const keys = body.keys;
  if (
    !Array.isArray(keys) || keys.length === 0 || keys.length > MAX_MARK_ITEMS
    || !keys.every((key) => typeof key === 'string' && KEY_PATTERN.test(key))
  ) {
    return NextResponse.json({ error: `keys must list 1–${MAX_MARK_ITEMS} titles from the preview` }, { status: 400 });
  }
  try {
    const result = await markLeavingSoon(
      { id: auth.user.id, username: auth.user.username },
      body.mediaType,
      keys as string[],
    );
    return NextResponse.json(result);
  } catch (error) {
    return libraryCleanupErrorResponse(error);
  }
}

export const POST = withApiLogging(postHandler, 'api/cleanup/library/leaving-soon');
