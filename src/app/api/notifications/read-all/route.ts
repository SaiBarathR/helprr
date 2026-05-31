import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ownerScope } from '@/lib/user-dto';
import { withApiLogging } from '@/lib/api-logger';

async function postHandler() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    await prisma.notificationHistory.updateMany({
      // Members mark only their own as read; admins clear everything.
      where: { read: false, ...ownerScope(auth.user) },
      data: { read: true },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

export const POST = withApiLogging(postHandler, 'api/notifications/read-all');
