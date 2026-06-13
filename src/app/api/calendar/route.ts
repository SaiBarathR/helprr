import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { startOfLocalDay, toZonedDate } from '@/lib/timezone';
import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';
import type {
  CalendarEvent,
  MovieReleaseType,
} from '@/types';

const CALENDAR_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=120, stale-while-revalidate=300',
} as const;

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('calendar.view');
  if (capError) return capError;

  try {
    const { searchParams } = new URL(request.url);
    let start = searchParams.get('start');
    let end = searchParams.get('end');
    const days = searchParams.get('days');
    const fullDay = searchParams.get('fullDay') === 'true';
    const type = searchParams.get('type');

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
    // so the cached events are identical per user. Now-anchored windows drift at most one TTL.
    const cacheKeySeed = `${start ?? ''}|${end ?? ''}|${days ?? ''}|${fullDay}`;
    const cachedEvents = await getCachedJson<CalendarEvent[]>('calendar', cacheKeySeed);
    if (cachedEvents) {
      const filtered =
        type && type !== 'all' ? cachedEvents.filter((e) => e.type === type) : cachedEvents;
      return NextResponse.json(filtered, { headers: CALENDAR_CACHE_HEADERS });
    }

    // If days provided without start/end, allow opting into full local day boundaries.
    // fullDay=true respects process TZ (e.g. TZ=Asia/Kolkata) for date-only widgets.
    if (!start || !end) {
      const settings = await getOrCreateAppSettings();
      const parsedDays = days ? parseInt(days, 10) : 30;
      const daysNum = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 30;
      const tz = settings.timeZone;

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

    const events: CalendarEvent[] = [];
    const startMs = new Date(start!).getTime();
    const endMs = new Date(end!).getTime();

    // Fetch from every instance of Sonarr, Radarr and Lidarr in parallel, tagging
    // each event with its instance so detail links resolve to the right one.
    const [sonarrClients, radarrClients, lidarrClients] = await Promise.all([
      getSonarrClients().catch(() => []),
      getRadarrClients().catch(() => []),
      getLidarrClients().catch(() => []),
    ]);

    await Promise.all([
      ...sonarrClients.map(async ({ connection, client }) => {
        try {
          const entries = await client.getCalendar(start!, end!);
          for (const ep of entries) {
            events.push({
              id: `sonarr-${connection.id}-${ep.id}`,
              type: 'episode',
              title: ep.series.title,
              subtitle: `S${ep.seasonNumber.toString().padStart(2, '0')}E${ep.episodeNumber.toString().padStart(2, '0')} - ${ep.title}`,
              date: ep.airDateUtc,
              hasFile: ep.hasFile,
              monitored: ep.monitored,
              seriesId: ep.seriesId,
              images: ep.series.images,
              instanceId: connection.id,
              instanceLabel: connection.label,
              ...(ep.finaleType ? { finaleType: ep.finaleType } : {}),
            });
          }
        } catch {
          // Skip unreachable instance.
        }
      }),
      ...radarrClients.map(async ({ connection, client }) => {
        try {
          const entries = await client.getCalendar(start!, end!);
          for (const m of entries) {
            const releases: Array<[MovieReleaseType, string | undefined]> = [
              ['cinema', m.inCinemas],
              ['physical', m.physicalRelease],
              ['digital', m.digitalRelease],
            ];
            for (const [releaseType, dateStr] of releases) {
              if (!dateStr) continue;
              const ms = new Date(dateStr).getTime();
              if (!Number.isFinite(ms)) continue;
              if (ms < startMs || ms > endMs) continue;
              events.push({
                id: `radarr-${connection.id}-${m.id}-${releaseType}`,
                type: 'movie',
                title: m.title,
                subtitle: `${m.year} - ${m.studio}`,
                date: dateStr,
                hasFile: m.hasFile,
                monitored: m.monitored,
                movieId: m.id,
                images: m.images,
                releaseType,
                instanceId: connection.id,
                instanceLabel: connection.label,
              });
            }
          }
        } catch {
          // Skip unreachable instance.
        }
      }),
      ...lidarrClients.map(async ({ connection, client }) => {
        try {
          const entries = await client.getCalendar(start!, end!);
          for (const album of entries) {
            if (!album.releaseDate) continue;
            const ms = new Date(album.releaseDate).getTime();
            if (!Number.isFinite(ms) || ms < startMs || ms > endMs) continue;
            const stats = album.statistics;
            const complete = !!stats && stats.totalTrackCount > 0 && stats.trackFileCount >= stats.totalTrackCount;
            events.push({
              id: `lidarr-${connection.id}-${album.id}`,
              type: 'album',
              title: album.artist?.artistName ?? album.title,
              subtitle: album.title,
              date: album.releaseDate,
              hasFile: complete,
              monitored: album.monitored,
              artistId: album.artistId,
              albumId: album.id,
              images: album.images,
              instanceId: connection.id,
              instanceLabel: connection.label,
            });
          }
        } catch {
          // Skip unreachable instance.
        }
      }),
    ]);

    // Sort by date ascending
    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    await setCachedJson('calendar', cacheKeySeed, events, 120);

    // Filter by type if specified
    const filtered =
      type && type !== 'all'
        ? events.filter((e) => e.type === type)
        : events;

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
