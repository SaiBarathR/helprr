import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ownerScope } from '@/lib/user-dto';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

// Distinct event types present in the caller's visible notification history.
// The notifications filter uses this so any type the user can SEE is also
// filterable, even without the matching notify.* receive capability.
async function getHandler() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const rows = await prisma.notificationHistory.groupBy({
      by: ['eventType'],
      where: ownerScope(auth.user),
    });
    return NextResponse.json({ eventTypes: rows.map((r) => r.eventType) });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed');
  }
}

export const GET = withApiLogging(getHandler, 'api/notifications/event-types');
