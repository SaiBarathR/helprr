import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { consumeCleanupPreview, InvalidCleanupPreviewError } from '@/lib/cleanup/preview-store';
import { StaleCleanupPreviewError } from '@/lib/cleanup/binding';
import {
  executeLibraryDeletion,
  LibraryDeletionBusyError,
  withLibraryDeletionLock,
} from '@/lib/library-cleanup/service';
import { libraryCleanupErrorResponse, readJsonObject } from '../../_shared';

// "Delete now": consumes the preview token, re-checks every exclusion from
// fresh data (any source unreadable → nothing deleted; no Seerr connection at
// all → runs, with a warning that requests in Seerr were not checked), then
// deletes each title with its files, one audited call per title.
async function postHandler(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await readJsonObject(req);
  const token = body?.previewToken;
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) {
    return NextResponse.json(
      { error: 'A valid previewToken is required. Run a fresh deletion preview first.' },
      { status: 428 },
    );
  }

  try {
    const result = await withLibraryDeletionLock(async () => {
      const preview = await consumeCleanupPreview(auth.user.id, 'library', token);
      return executeLibraryDeletion(
        preview.binding,
        preview.previewId,
        { id: auth.user.id, username: auth.user.username },
      );
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LibraryDeletionBusyError) {
      return NextResponse.json({ error: error.message, code: 'BUSY' }, { status: 409 });
    }
    if (error instanceof InvalidCleanupPreviewError) {
      return NextResponse.json({ error: error.message, code: 'PREVIEW_INVALID' }, { status: 409 });
    }
    if (error instanceof StaleCleanupPreviewError) {
      return NextResponse.json({ error: 'Something changed since the preview (a title was watched, kept, requested or removed). Nothing was deleted; run the preview again.', code: 'PREVIEW_STALE' }, { status: 409 });
    }
    return libraryCleanupErrorResponse(error);
  }
}

// previewToken is a short-lived bearer capability; never include this request
// body in optional failed-request logging.
export const POST = withApiLogging(postHandler, 'api/cleanup/library/delete/run', { logBodies: false });
