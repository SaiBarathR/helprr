import { Readable } from 'stream';
import { isAxiosError } from 'axios';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { confirmAdminStepUp } from '@/lib/server/confirm-password';
import { findBackup, parseBackupId, recordSystemAction, resolveSystemTarget } from '@/lib/server/arr-system';

export const runtime = 'nodejs';

// One of an instance's backups, streamed from the app to the admin. The zip
// holds the app's API key and every password it keeps (indexers, download
// clients, notifications), none of which Helprr otherwise shows, so it takes
// the admin's password (and a code with two-step sign-in on). A POST, so the
// password goes in the body; the file passes straight through: not kept, not
// cached (no-store), and its body not logged. Recorded in the security audit.
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
    const stepUp = await confirmAdminStepUp(request, auth.user, body, 'arr-backup-download', 'Downloading a backup');
    if (stepUp) return stepUp;
    const found = await findBackup(target.client, id);
    if (!found) return NextResponse.json({ error: 'That backup is no longer there' }, { status: 404 });
    const file = await target.client.systemAdmin.downloadBackup(found.path);
    // An app that doesn't take the key on its backup files answers with its
    // sign-in page (same host, so the redirect is followed): not a backup.
    if (/text\/html/i.test(file.contentType)) {
      file.stream.destroy();
      return NextResponse.json({ error: 'The app sent a page instead of the backup. Download it in the app.' }, { status: 502 });
    }
    // A download left half way stops the app's stream too.
    request.signal.addEventListener('abort', () => file.stream.destroy(), { once: true });
    logger.info('App backup downloaded', {
      userId: auth.user.id,
      username: auth.user.username,
      instanceId: target.instanceId,
      backup: found.backup.name,
    }, { scope: target.type.toLowerCase() });
    try {
      await recordSystemAction(request, auth.user, target, `backup downloaded: ${found.backup.name}`);
    } catch (error) {
      // Not handed on, so the app's stream is let go rather than left holding its socket.
      file.stream.destroy();
      throw error;
    }
    return new Response(Readable.toWeb(file.stream) as ReadableStream<Uint8Array>, {
      headers: {
        'Content-Type': 'application/zip',
        // The name passed the list's check (letters, digits, dot, dash, underscore).
        'Content-Disposition': `attachment; filename="${found.backup.name}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    // An error answer to a streamed request is itself a stream: drain it, so its socket goes back to the pool.
    if (isAxiosError(error)) (error.response?.data as { destroy?: () => void } | undefined)?.destroy?.();
    return upstreamErrorResponse(error, 'Failed to download the backup');
  }
}

export const POST = withApiLogging(postHandler, 'api/admin/arr-system/backups/[id]/download', { logBodies: false });
