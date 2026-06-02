import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient, getLidarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { startOfLocalDay, toZonedDate } from '@/lib/timezone';
import type {
  CalendarEvent,
  MovieReleaseType,
  SonarrCalendarEntry,
  RadarrCalendarEntry,
  LidarrCalendarEntry,
} from '@/types';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

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

    // Fetch from Sonarr, Radarr and Lidarr in parallel
    const [sonarrResult, radarrResult, lidarrResult] = await Promise.allSettled([
      (async () => {
        try {
          const sonarr = await getSonarrClient();
          return await sonarr.getCalendar(start!, end!);
        } catch {
          return [] as SonarrCalendarEntry[];
        }
      })(),
      (async () => {
        try {
          const radarr = await getRadarrClient();
          return await radarr.getCalendar(start!, end!);
        } catch {
          return [] as RadarrCalendarEntry[];
        }
      })(),
      (async () => {
        try {
          const lidarr = await getLidarrClient();
          return await lidarr.getCalendar(start!, end!);
        } catch {
          return [] as LidarrCalendarEntry[];
        }
      })(),
    ]);

    const startMs = new Date(start!).getTime();
    const endMs = new Date(end!).getTime();

    // Transform Sonarr episodes
    if (sonarrResult.status === 'fulfilled') {
      for (const ep of sonarrResult.value) {
        events.push({
          id: `sonarr-${ep.id}`,
          type: 'episode',
          title: ep.series.title,
          subtitle: `S${ep.seasonNumber.toString().padStart(2, '0')}E${ep.episodeNumber.toString().padStart(2, '0')} - ${ep.title}`,
          date: ep.airDateUtc,
          hasFile: ep.hasFile,
          monitored: ep.monitored,
          seriesId: ep.seriesId,
          images: ep.series.images,
          ...(ep.finaleType ? { finaleType: ep.finaleType } : {}),
        });
      }
    }

    // Transform Radarr movies — fan out one event per release type in window
    if (radarrResult.status === 'fulfilled') {
      for (const m of radarrResult.value) {
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
            id: `radarr-${m.id}-${releaseType}`,
            type: 'movie',
            title: m.title,
            subtitle: `${m.year} - ${m.studio}`,
            date: dateStr,
            hasFile: m.hasFile,
            monitored: m.monitored,
            movieId: m.id,
            images: m.images,
            releaseType,
          });
        }
      }
    }

    // Transform Lidarr album releases
    if (lidarrResult.status === 'fulfilled') {
      for (const album of lidarrResult.value) {
        if (!album.releaseDate) continue;
        const ms = new Date(album.releaseDate).getTime();
        if (!Number.isFinite(ms) || ms < startMs || ms > endMs) continue;
        const stats = album.statistics;
        const complete = !!stats && stats.totalTrackCount > 0 && stats.trackFileCount >= stats.totalTrackCount;
        events.push({
          id: `lidarr-${album.id}`,
          type: 'album',
          title: album.artist?.artistName ?? album.title,
          subtitle: album.title,
          date: album.releaseDate,
          hasFile: complete,
          monitored: album.monitored,
          artistId: album.artistId,
          albumId: album.id,
          images: album.images,
        });
      }
    }

    // Sort by date ascending
    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Filter by type if specified
    const filtered =
      type && type !== 'all'
        ? events.filter((e) => e.type === type)
        : events;

    return NextResponse.json(filtered);
  } catch (error) {
    console.error('Failed to fetch calendar:', error);
    return NextResponse.json(
      { error: 'Failed to fetch calendar data' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/calendar');
