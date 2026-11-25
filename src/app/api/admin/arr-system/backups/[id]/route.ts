import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { confirmAdminStepUp } from '@/lib/server/confirm-password';
import { BACKUP_DELETE_PHRASE } from '@/lib/arr-system';
import {
  NO_STORE,
  findBackup,
  maybeDoneResponse,
  parseBackupId,
  recordSystemAction,
  resolveSystemTarget,
  upstreamNoAnswer,
} from '@/lib/server/arr-system';

// Delete one of an instance's backups from its disk. Admins only, with the
// typed word and the admin's password (and a code with two-step sign-in on):
// it can't be undone, and a backup may be the only copy to go back to.
async function deleteHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body: unknown = await request.json().catch(() => null);
    const resolved = await resolveSystemTarget(request.nextUrl.searchParams.get('instanceId'));
    if (!resolved.ok) return resolved.response;
    const { target } = resolved;
    const id = parseBackupId((await params).id);
    if (id === null) return NextResponse.json({ error: 'Invalid backup id' }, { status: 400 });
    if ((body as { confirm?: unknown } | null)?.confirm !== BACKUP_DELETE_PHRASE) {
      return NextResponse.json({ error: `Type ${BACKUP_DELETE_PHRASE} to confirm` }, { status: 400 });
    }
    const stepUp = await confirmAdminStepUp(request, auth.user, body, 'arr-backup-delete', 'Deleting a backup');
    if (stepUp) return stepUp;
    const found = await findBackup(target.client, id);
    if (!found) return NextResponse.json({ error: 'That backup is no longer there' }, { status: 404 });
    try {
      await target.client.systemAdmin.deleteBackup(id);
    } catch (error) {
      if (!upstreamNoAnswer(error)) throw error;
      return maybeDoneResponse(request, auth.user, target, `backup delete sent: ${found.backup.name}`,
        'The app did not answer. The backup may be deleted: check the list again.');
    }
    logger.info('App backup deleted', {
      userId: auth.user.id,
      username: auth.user.username,
      instanceId: target.instanceId,
      backup: found.backup.name,
    }, { scope: target.type.toLowerCase() });
    await recordSystemAction(request, auth.user, target, `backup deleted: ${found.backup.name}`);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to delete the backup');
  }
}

export const DELETE = withApiLogging(deleteHandler, 'api/admin/arr-system/backups/[id]', { logBodies: false });
