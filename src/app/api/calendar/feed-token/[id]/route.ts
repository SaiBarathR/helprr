import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { recordSecurityEvent } from '@/lib/security-audit';

/**
 * Turn one of your own feed links off; calendars subscribed to it stop updating.
 * Only a session is needed: a person who lost calendar.view can still remove a
 * link (it already stopped working). Someone else's link answers 404.
 */
async function deleteHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const result = await prisma.calendarFeedToken.deleteMany({ where: { id, userId: auth.user.id } });
    if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await recordSecurityEvent(request, {
      actor: auth.user,
      action: 'CALENDAR_FEED_REVOKED',
      targetType: 'user',
      targetId: auth.user.id,
      targetLabel: auth.user.username,
    });
    return NextResponse.json({ revoked: true });
  } catch (error) {
    console.error(`[CalendarFeed] Failed to turn off feed link: ${error instanceof Error ? error.name : 'unknown error'}`);
    return NextResponse.json({ error: 'Failed to turn off the calendar link' }, { status: 500 });
  }
}

export const DELETE = withApiLogging(deleteHandler, 'api/calendar/feed-token/[id]', { logBodies: false });
