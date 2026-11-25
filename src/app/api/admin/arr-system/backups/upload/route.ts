import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { confirmAdminStepUp } from '@/lib/server/confirm-password';
import { BACKUP_RESTORE_PHRASE, BACKUP_UPLOAD_MAX_BYTES } from '@/lib/arr-system';
import {
  NO_STORE,
  maybeDoneResponse,
  resolveSystemTarget,
  restartAfterRestore,
  uploadedBackupProblem,
  upstreamNoAnswer,
} from '@/lib/server/arr-system';

export const runtime = 'nodejs';

/** Helprr's request proxy keeps this much of a body and silently drops the rest (Next's default). */
const PROXY_BODY_LIMIT = 10 * 1024 * 1024;

// Restore an instance from a backup zip the admin picks, then restart it, as
// the app's System → Backup → Restore does. Admins only, with the typed word
// and the admin's password (and a code with two-step sign-in on). The file is
// checked (size, a zip holding this app's database) and handed to the app from
// memory: never written to disk or kept after the request, and never logged.
async function postHandler(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    // A body over the proxy's limit arrives cut short with no error, so the
    // declared length is required and checked before anything is read.
    const length = Number(request.headers.get('content-length'));
    if (!request.headers.has('content-length') || !Number.isSafeInteger(length)) {
      return NextResponse.json({
        error: 'Helprr couldn’t tell how big the file is (a proxy in between may have dropped it), so it can’t check that all of it arrived. Restore it in the app.',
      }, { status: 411 });
    }
    if (length > PROXY_BODY_LIMIT) {
      return NextResponse.json({ error: 'That file is too big to restore from Helprr. Restore it in the app.' }, { status: 413 });
    }
    const resolved = await resolveSystemTarget(request.nextUrl.searchParams.get('instanceId'));
    if (!resolved.ok) return resolved.response;
    const { target } = resolved;
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: 'Expected a form with the file' }, { status: 400 });
    const file = form.get('file');
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: 'Choose a backup file' }, { status: 400 });
    }
    if (file.size > BACKUP_UPLOAD_MAX_BYTES) {
      return NextResponse.json({ error: 'That file is too big to restore from Helprr. Restore it in the app.' }, { status: 413 });
    }
    if (form.get('confirm') !== BACKUP_RESTORE_PHRASE) {
      return NextResponse.json({ error: `Type ${BACKUP_RESTORE_PHRASE} to confirm` }, { status: 400 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const problem = uploadedBackupProblem(target.type, bytes);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const code = form.get('code');
    const stepUp = await confirmAdminStepUp(request, auth.user, {
      currentPassword: form.get('currentPassword'),
      code: typeof code === 'string' ? code : undefined,
    }, 'arr-backup-restore', 'Restoring a backup');
    if (stepUp) return stepUp;
    // Sent under a fixed name: the app only looks at the extension.
    try {
      await target.client.systemAdmin.restoreUploadedBackup(new Blob([bytes], { type: 'application/zip' }), 'backup.zip');
    } catch (error) {
      if (!upstreamNoAnswer(error)) throw error;
      return maybeDoneResponse(request, auth.user, target, 'backup restore from a file sent',
        'The app did not answer. The restore may have gone through: restart the app to finish it, then check.');
    }
    const restarted = await restartAfterRestore(request, auth.user, target, 'backup restored from a file');
    return NextResponse.json({ ok: true, restarted }, { headers: NO_STORE });
  } catch (error) {
    return upstreamErrorResponse(error, 'The app could not restore that file');
  }
}

export const POST = withApiLogging(postHandler, 'api/admin/arr-system/backups/upload', { logBodies: false });
