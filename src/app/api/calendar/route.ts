import { NextRequest, NextResponse } from 'next/server';
import { requireUser, requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { startOfLocalDay, toZonedDate, getLocalDateKey } from '@/lib/timezone';
import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';
import { fetchServiceCalendarEvents } from '@/lib/calendar-events';
import {
  fetchScheduledCalendarEvents,
  mergeCalendarWithScheduled,
} from '@/lib/scheduled-alerts/calendar';
import type { CalendarEvent } from '@/types';

const CALENDAR_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=120, stale-while-revalidate=300',
  // Partition the private cache by session cookie so a capability-gated response can't be
  // replayed from the browser cache to a different (or logged-out) user within the TTL.
  'Vary': 'Cookie',
} as const;

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('calendar.view');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    let start = searchParams.get('start');
    let end = searchParams.get('end');
    const days = searchParams.get('days');
    const fullDay = searchParams.get('fullDay') === 'true';
    const type = searchParams.get('type');
    const includeScheduled = searchParams.get('includeScheduled') === 'true';

    const authUser = includeScheduled ? await requireUser() : null;
    if (includeScheduled && !authUser?.ok) return authUser!.response;

    if (start) {
      const parsed = new Date(start);
      if (!Number.isFinite(parsed.getTime())) {
        return NextResponse.json({ error: 'Invalid start date' }, { status: 400 });
      }
    }
    if (end) {
      const parsed = new Date(end);
      if (!Number.isFinite(parsed.getTime())) {
        return NextResponse.json({ error: 'Invalid end date' }, { status: 400 });
      }
    }

    // Cache the full merged event set keyed by the requested window (not `type`, which is a
    // post-fetch filter). All authorized callers see every instance (binary capability gate),
    // so the cached events are identical per user. When start/end are absent the window is
    // now-anchored, so fold today's LOCAL date into the key — otherwise a cached entry could
    // outlive local midnight and serve the previous day's window.
    const explicitWindow = Boolean(start && end);
    const settings = explicitWindow ? null : await getOrCreateAppSettings();
    const anchorKey = settings ? getLocalDateKey(new Date(), settings.timeZone) : '';
    const cacheKeySeed = `${start ?? ''}|${end ?? ''}|${days ?? ''}|${fullDay}|${anchorKey}`;
    const cachedEvents = !includeScheduled
      ? await getCachedJson<CalendarEvent[]>('calendar', cacheKeySeed)
      : null;
    if (cachedEvents) {
      const filtered =
        type && type !== 'all' ? cachedEvents.filter((e) => e.type === type) : cachedEvents;
      return NextResponse.json(filtered, { headers: CALENDAR_CACHE_HEADERS });
    }

    // If days provided without start/end, allow opting into full local day boundaries.
    // fullDay=true respects process TZ (e.g. TZ=Asia/Kolkata) for date-only widgets.
    if (!start || !end) {
      const parsedDays = days ? parseInt(days, 10) : 30;
      const daysNum = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 30;
      // settings was fetched above for the now-anchored key; reuse it (the ?? never runs).
      const tz = (settings ?? await getOrCreateAppSettings()).timeZone;

      let startDate: Date;
      let endDate: Date;

      if (start && !end) {
        // Anchor on caller-provided start; derive end forward by daysNum.
        const parsedStart = new Date(start);
        if (!Number.isFinite(parsedStart.getTime())) {
          return NextResponse.json({ error: 'Invalid start date' }, { status: 400 });
        }
        startDate = fullDay ? startOfLocalDay(parsedStart, tz) : parsedStart;
        const candidateEnd = toZonedDate(startDate, tz);
        candidateEnd.setDate(candidateEnd.getDate() + daysNum);
        if (fullDay) candidateEnd.setMilliseconds(candidateEnd.getMilliseconds() - 1);
        endDate = candidateEnd;
      } else if (!start && end) {
        // Anchor on caller-provided end; derive start backward by daysNum.
        const parsedEnd = new Date(end);
        if (!Number.isFinite(parsedEnd.getTime())) {
          return NextResponse.json({ error: 'Invalid end date' }, { status: 400 });
        }
        endDate = parsedEnd;
        const candidateStart = toZonedDate(parsedEnd, tz);
        candidateStart.setDate(candidateStart.getDate() - daysNum);
        if (fullDay) {
          startDate = startOfLocalDay(candidateStart, tz);
          // Adjust the supplied end to end-of-day inclusive when fullDay is set,
          // based on the local-day boundary so any time component on parsedEnd
          // doesn't shrink or extend the day.
          const adjustedEnd = toZonedDate(startOfLocalDay(parsedEnd, tz), tz);
          adjustedEnd.setDate(adjustedEnd.getDate() + 1);
          adjustedEnd.setMilliseconds(adjustedEnd.getMilliseconds() - 1);
          endDate = adjustedEnd;
        } else {
          startDate = candidateStart;
        }
      } else {
        // Both missing — default to a window starting now.
        startDate = fullDay ? startOfLocalDay(new Date(), tz) : new Date();
        const candidateEnd = toZonedDate(startDate, tz);
        candidateEnd.setDate(candidateEnd.getDate() + daysNum);
        if (fullDay) candidateEnd.setMilliseconds(candidateEnd.getMilliseconds() - 1);
        endDate = candidateEnd;
      }

      start = startDate.toISOString();
      end = endDate.toISOString();
    }

    const { events, cacheable } = await fetchServiceCalendarEvents(start!, end!);
    if (cacheable) {
      await setCachedJson('calendar', cacheKeySeed, events, 120);
    }

    // Filter by type if specified
    let filtered =
      type && type !== 'all'
        ? events.filter((e) => e.type === type)
        : events;

    if (includeScheduled && authUser?.ok) {
      const scheduled = await fetchScheduledCalendarEvents({
        userId: authUser.user.id,
        start: new Date(start!),
        end: new Date(end!),
      });
      filtered = mergeCalendarWithScheduled(filtered, scheduled);
      if (type && type !== 'all') {
        filtered = filtered.filter((e) => e.type === type);
      }
    }

    return NextResponse.json(filtered, { headers: CALENDAR_CACHE_HEADERS });
  } catch (error) {
    console.error('Failed to fetch calendar:', error);
    return NextResponse.json(
      { error: 'Failed to fetch calendar data' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/calendar');
