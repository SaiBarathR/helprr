import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { issueCleanupPreview } from '@/lib/cleanup/preview-store';
import { previewLibraryDeletion } from '@/lib/library-cleanup/service';
import { libraryCleanupErrorResponse, readJsonObject } from '../../_shared';

// Re-checks every title whose countdown ended and binds the ones still safe to
// delete to a single-use, five-minute preview token. Deletes nothing.
async function postHandler(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await readJsonObject(req);
  if (!body || typeof body.addImportListExclusion !== 'boolean') {
    return NextResponse.json({ error: 'addImportListExclusion must be true or false' }, { status: 400 });
  }
  try {
    const preview = await previewLibraryDeletion(body.addImportListExclusion);
    // Titles already gone from the arr are cleared by a run too, so they also get a token.
    const actionable = preview.items.some((item) => item.status !== 'protected');
    const issued = actionable ? await issueCleanupPreview(auth.user.id, preview.binding) : null;
    return NextResponse.json({
      ...(issued ?? {}),
      items: preview.items,
      readyCount: preview.readyCount,
      warnings: preview.warnings,
    });
  } catch (error) {
    return libraryCleanupErrorResponse(error);
  }
}

export const POST = withApiLogging(postHandler, 'api/cleanup/library/delete/preview');
