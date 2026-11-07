import { NextRequest, NextResponse } from 'next/server';
import { withApiLogging } from '@/lib/api-logger';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { prisma } from '@/lib/db';
import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';
import { fetchServiceCalendarEvents } from '@/lib/calendar-events';
import { applyFeedFilters, parseFeedFilters } from '@/lib/calendar-feed/filters';
import { buildCalendarFeed } from '@/lib/calendar-feed/ics';
import {
  authorizeFeedToken,
  feedMissRetryAfter,
  hashFeedToken,
  isWellFormedFeedToken,
  recordFeedMiss,
  takeFeedRateLimit,
} from '@/lib/calendar-feed/token';
import { getClientIp } from '@/lib/login-rate-limit';
import { normalizeTimeZone, startOfLocalDay, toZonedDate } from '@/lib/timezone';
import type { CalendarEvent } from '@/types';

// The subscribable calendar (Calendar → Subscribe in Calendar). Public
// in the proxy by exact path: calendar apps send no session, so the per-user
// feed token in ?token= is the credential (one per named link). It is checked on
// every fetch, along with the owner's status and calendar.view, and every
// refusal is the same 404.
// A client IP (trusted proxy only) with too many refused tokens gets 429 for
// any token until its window ends. The token is redacted from the request log.

const PAST_DAYS = 30;
const FUTURE_DAYS = 180;
const EVENTS_CACHE_SECONDS = 300;

function textResponse(body: string, status: number, headers: Record<string, string> = {}): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

const notFound = () => textResponse('Not found', 404);

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const token = params.get('token');
  if (!isWellFormedFeedToken(token)) return notFound();
  const tokenHash = hashFeedToken(token);

  const ip = getClientIp(request);
  if (ip !== undefined) {
    let missWait: number;
    try {
      missWait = await feedMissRetryAfter(ip);
    } catch {
      return textResponse('Calendar feed unavailable', 503);
    }
    if (missWait > 0) return textResponse('Too many requests', 429, { 'Retry-After': String(missWait) });
  }

  const link = await authorizeFeedToken(tokenHash);
  if (!link) {
    if (ip !== undefined) await recordFeedMiss(ip);
    return notFound();
  }

  // Only a live token gets a bucket, so random guesses cannot fill Redis with keys.
  let retryAfter: number;
  try {
    retryAfter = await takeFeedRateLimit(tokenHash);
  } catch {
    return textResponse('Calendar feed unavailable', 503);
  }
  if (retryAfter > 0) return textResponse('Too many requests', 429, { 'Retry-After': String(retryAfter) });

  const filters = parseFeedFilters(params);
  if (!filters) return textResponse('Invalid filter', 400);

  try {
    // Release days (all-day movie and album dates) fall on the link owner's own
    // time zone when they have one, else the server's. Whole local days, so the
    // window (and its cache key) moves once a day.
    const [appSettings, ownerSettings] = await Promise.all([
      getOrCreateAppSettings(),
      prisma.userSettings.findUnique({ where: { userId: link.user.id }, select: { timeZone: true } }),
    ]);
    const timeZone = normalizeTimeZone(ownerSettings?.timeZone, appSettings.timeZone);
    const today = startOfLocalDay(new Date(), timeZone);
    const startDate = toZonedDate(today, timeZone);
    startDate.setDate(startDate.getDate() - PAST_DAYS);
    const endDate = toZonedDate(today, timeZone);
    endDate.setDate(endDate.getDate() + FUTURE_DAYS);
    const start = startDate.toISOString();
    const end = endDate.toISOString();

    const cacheKeySeed = `feed|${start}|${end}`;
    let events = await getCachedJson<CalendarEvent[]>('calendar', cacheKeySeed);
    if (!events) {
      const result = await fetchServiceCalendarEvents(start, end);
      // Every instance failed: say so, so the calendar app keeps the copy it has
      // instead of replacing it with an empty one.
      if (!result.cacheable) return textResponse('Calendar feed unavailable', 503);
      events = result.events;
      await setCachedJson('calendar', cacheKeySeed, events, EVENTS_CACHE_SECONDS);
    }

    // The link's own filters, then any a pre-named-links URL carries.
    const shown = applyFeedFilters(applyFeedFilters(events, link.filters), filters);
    return new NextResponse(buildCalendarFeed(shown, { timeZone, name: link.name }), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="helprr.ics"',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    console.error(`[CalendarFeed] Failed to build feed: ${error instanceof Error ? error.name : 'unknown error'}`);
    return textResponse('Calendar feed unavailable', 500);
  }
}

export const GET = withApiLogging(getHandler, 'api/calendar/feed.ics', {
  logBodies: false,
  redactQueryParams: ['token'],
});
