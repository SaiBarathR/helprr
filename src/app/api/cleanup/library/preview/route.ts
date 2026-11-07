import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { isLibraryMediaType } from '@/lib/library-cleanup/config';
import { previewLibraryCandidates } from '@/lib/library-cleanup/service';
import { libraryCleanupErrorResponse, readJsonObject } from '../_shared';

// Read-only dry run: lists what the saved rule would offer to mark Leaving soon.
async function postHandler(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await readJsonObject(req);
  if (!body || !isLibraryMediaType(body.mediaType)) {
    return NextResponse.json({ error: 'mediaType must be "movie" or "series"' }, { status: 400 });
  }
  try {
    return NextResponse.json(await previewLibraryCandidates(body.mediaType));
  } catch (error) {
    return libraryCleanupErrorResponse(error);
  }
}

export const POST = withApiLogging(postHandler, 'api/cleanup/library/preview');
