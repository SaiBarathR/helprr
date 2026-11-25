import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { confirmAdminStepUp } from '@/lib/server/confirm-password';
import { BACKUP_RESTORE_PHRASE } from '@/lib/arr-system';
import {
  NO_STORE,
  findBackup,
  maybeDoneResponse,
  parseBackupId,
  resolveSystemTarget,
  restartAfterRestore,
  upstreamNoAnswer,
} from '@/lib/server/arr-system';

// Restore one of an instance's listed backups, then restart it so the restore
// takes effect, as the app's own System → Backup does. Admins only, with the
// typed word and the admin's password (and a code with two-step sign-in on):
// everything changed in the app since that backup is lost.
async function postHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body: unknown = await request.json().catch(() => null);
    const resolved = await resolveSystemTarget(request.nextUrl.searchParams.get('instanceId'));
    if (!resolved.ok) return resolved.response;
    const { target } = resolved;
    const id = parseBackupId((await params).id);
    if (id === null) return NextResponse.json({ error: 'Invalid backup id' }, { status: 400 });
    if ((body as { confirm?: unknown } | null)?.confirm !== BACKUP_RESTORE_PHRASE) {
      return NextResponse.json({ error: `Type ${BACKUP_RESTORE_PHRASE} to confirm` }, { status: 400 });
    }
    const stepUp = await confirmAdminStepUp(request, auth.user, body, 'arr-backup-restore', 'Restoring a backup');
    if (stepUp) return stepUp;
    const found = await findBackup(target.client, id);
    if (!found) return NextResponse.json({ error: 'That backup is no longer there' }, { status: 404 });
    try {
      await target.client.systemAdmin.restoreBackup(id);
    } catch (error) {
      if (!upstreamNoAnswer(error)) throw error;
      return maybeDoneResponse(request, auth.user, target, `backup restore sent: ${found.backup.name}`,
        'The app did not answer. The restore may have gone through: restart the app to finish it, then check.');
    }
    const restarted = await restartAfterRestore(request, auth.user, target, `backup restored: ${found.backup.name}`);
    return NextResponse.json({ ok: true, restarted }, { headers: NO_STORE });
  } catch (error) {
    return upstreamErrorResponse(error, 'The app could not restore that backup');
  }
}

export const POST = withApiLogging(postHandler, 'api/admin/arr-system/backups/[id]/restore', { logBodies: false });
