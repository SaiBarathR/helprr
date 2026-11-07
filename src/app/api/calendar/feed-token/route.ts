import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { parseFeedFiltersInput, storedFeedFilters } from '@/lib/calendar-feed/filters';
import { generateFeedToken, hashFeedToken, MAX_FEED_LINKS } from '@/lib/calendar-feed/token';
import { configuredAppOrigin } from '@/lib/request-utils';
import { recordSecurityEvent } from '@/lib/security-audit';

// The signed-in user's own calendar feed links: several, each named and with its
// own filters. Only a token's hash is kept, so the token itself is in the POST
// response alone; to see a link again the person makes a new one and turns the
// old one off (/api/calendar/feed-token/[id]). Bodies are never logged.

const MAX_NAME_LENGTH = 60;

/**
 * Each link's name, filters, and when it was made and last fetched, plus the
 * configured APP_ORIGIN (null when unset), so a link made from a LAN http address
 * still points at the public https one.
 */
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('calendar.view');
  if (!auth.ok) return auth.response;

  const rows = await prisma.calendarFeedToken.findMany({
    where: { userId: auth.user.id },
    select: { id: true, name: true, type: true, instanceId: true, monitoredOnly: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({
    links: rows.map((row) => ({
      id: row.id,
      name: row.name,
      filters: storedFeedFilters(row),
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    })),
    max: MAX_FEED_LINKS,
    origin: configuredAppOrigin(),
  });
}

/** A link name: trimmed, 1–60 characters, no control characters; null when not. */
function parseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > MAX_NAME_LENGTH || /[\u0000-\u001F\u007F]/.test(name)) return null;
  return name;
}

/** Make a named link with its own filters ({ name, filters: { type, instanceId, monitoredOnly } }). */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('calendar.view');
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as { name?: unknown; filters?: unknown } | null;
  const name = parseName(body?.name);
  if (!name) return NextResponse.json({ error: `Give the link a name of up to ${MAX_NAME_LENGTH} characters` }, { status: 400 });
  const filters = parseFeedFiltersInput(body?.filters);
  if (!filters) return NextResponse.json({ error: 'Invalid filters' }, { status: 400 });

  try {
    // A soft cap: two requests at the same moment can each pass it once.
    if (await prisma.calendarFeedToken.count({ where: { userId: auth.user.id } }) >= MAX_FEED_LINKS) {
      return NextResponse.json({ error: `You can have up to ${MAX_FEED_LINKS} calendar links; turn one off first` }, { status: 409 });
    }
    const token = generateFeedToken();
    const row = await prisma.calendarFeedToken.create({
      data: {
        userId: auth.user.id,
        name,
        type: filters.type,
        instanceId: filters.instanceId,
        monitoredOnly: filters.monitoredOnly,
        tokenHash: hashFeedToken(token),
      },
      select: { id: true, createdAt: true },
    });
    await recordSecurityEvent(request, {
      actor: auth.user,
      action: 'CALENDAR_FEED_CREATED',
      targetType: 'user',
      targetId: auth.user.id,
      targetLabel: auth.user.username,
    });
    return NextResponse.json({ id: row.id, token, name, filters, createdAt: row.createdAt.toISOString() });
  } catch (error) {
    console.error(`[CalendarFeed] Failed to make feed link: ${error instanceof Error ? error.name : 'unknown error'}`);
    return NextResponse.json({ error: 'Failed to make the calendar link' }, { status: 500 });
  }
}

const LOGGING = { logBodies: false } as const;
export const GET = withApiLogging(getHandler, 'api/calendar/feed-token', LOGGING);
export const POST = withApiLogging(postHandler, 'api/calendar/feed-token', LOGGING);
