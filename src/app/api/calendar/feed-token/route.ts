import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser, requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { generateFeedToken, hashFeedToken } from '@/lib/calendar-feed/token';
import { recordSecurityEvent } from '@/lib/security-audit';

// The signed-in user's own calendar feed link. Only the token's hash is kept,
// so the token itself is in the POST response alone; to see a link again the
// person makes a new one, which stops the old one working. Bodies are never
// logged.

/** Whether a feed link is on, and when it was made and last fetched. */
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('calendar.view');
  if (!auth.ok) return auth.response;

  const row = await prisma.calendarFeedToken.findUnique({
    where: { userId: auth.user.id },
    select: { createdAt: true, lastUsedAt: true },
  });
  return NextResponse.json({
    active: Boolean(row),
    createdAt: row?.createdAt.toISOString() ?? null,
    lastUsedAt: row?.lastUsedAt?.toISOString() ?? null,
  });
}

/** Make the feed link, or replace it (the old link stops working at once). */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('calendar.view');
  if (!auth.ok) return auth.response;

  try {
    const token = generateFeedToken();
    const tokenHash = hashFeedToken(token);
    const createdAt = new Date();
    // Create first: the unique userId decides a race, so two clicks at once
    // still audit one creation and one rotation.
    let rotated = false;
    try {
      await prisma.calendarFeedToken.create({ data: { userId: auth.user.id, tokenHash, createdAt } });
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code !== 'P2002') throw error;
      rotated = true;
      await prisma.calendarFeedToken.upsert({
        where: { userId: auth.user.id },
        create: { userId: auth.user.id, tokenHash, createdAt },
        update: { tokenHash, createdAt, lastUsedAt: null },
      });
    }
    await recordSecurityEvent(request, {
      actor: auth.user,
      action: rotated ? 'CALENDAR_FEED_ROTATED' : 'CALENDAR_FEED_CREATED',
      targetType: 'user',
      targetId: auth.user.id,
      targetLabel: auth.user.username,
    });
    return NextResponse.json({ token, createdAt: createdAt.toISOString() });
  } catch (error) {
    console.error(`[CalendarFeed] Failed to make feed link: ${error instanceof Error ? error.name : 'unknown error'}`);
    return NextResponse.json({ error: 'Failed to make the calendar link' }, { status: 500 });
  }
}

/**
 * Turn the feed off. Only a session is needed: a person who lost calendar.view
 * can still remove their own link (it already stopped working).
 */
async function deleteHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const result = await prisma.calendarFeedToken.deleteMany({ where: { userId: auth.user.id } });
    if (result.count > 0) {
      await recordSecurityEvent(request, {
        actor: auth.user,
        action: 'CALENDAR_FEED_REVOKED',
        targetType: 'user',
        targetId: auth.user.id,
        targetLabel: auth.user.username,
      });
    }
    return NextResponse.json({ revoked: result.count > 0 });
  } catch (error) {
    console.error(`[CalendarFeed] Failed to turn off feed link: ${error instanceof Error ? error.name : 'unknown error'}`);
    return NextResponse.json({ error: 'Failed to turn off the calendar link' }, { status: 500 });
  }
}

const LOGGING = { logBodies: false } as const;
export const GET = withApiLogging(getHandler, 'api/calendar/feed-token', LOGGING);
export const POST = withApiLogging(postHandler, 'api/calendar/feed-token', LOGGING);
export const DELETE = withApiLogging(deleteHandler, 'api/calendar/feed-token', LOGGING);
