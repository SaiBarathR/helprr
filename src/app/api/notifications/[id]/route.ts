import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function putHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    // Members may only touch their own notifications.
    const ownerScope = auth.user.role === 'admin' ? {} : { userId: auth.user.id };
    const owned = await prisma.notificationHistory.findFirst({
      where: { id, ...ownerScope },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const notification = await prisma.notificationHistory.update({
      where: { id },
      data: { read: true },
    });
    return NextResponse.json(notification);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

async function deleteHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const ownerScope = auth.user.role === 'admin' ? {} : { userId: auth.user.id };
    const result = await prisma.notificationHistory.deleteMany({ where: { id, ...ownerScope } });
    if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

export const PUT = withApiLogging(putHandler, 'api/notifications/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/notifications/[id]');
