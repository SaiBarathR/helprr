import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { notifyEvent } from '@/lib/notification-service';
import { withApiLogging } from '@/lib/api-logger';

// Cancel (member, own) / decline (admin, any) a Helprr-pending request.
async function deleteHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const row = await prisma.pendingRequest.findUnique({
    where: { id },
    select: { id: true, userId: true, title: true, mediaType: true },
  });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isApprover = can(auth.user, 'requests.approve');
  const isOwner = row.userId === auth.user.id;
  if (!isApprover && !isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.pendingRequest.delete({ where: { id } });

  // An admin declining someone else's request tells the requester.
  if (isApprover && !isOwner && row.userId) {
    await notifyEvent({
      eventType: 'requestDeclined',
      title: 'Request declined',
      body: `Your request for ${row.title ?? (row.mediaType === 'tv' ? 'a series' : 'a movie')} was declined`,
      url: '/requests',
      userIds: [row.userId],
      ownerUserId: row.userId,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

export const DELETE = withApiLogging(deleteHandler, 'api/seerr/pending-requests/[id]');
