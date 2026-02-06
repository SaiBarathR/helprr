import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient } from '@/lib/service-helpers';
import type {
  CalendarEvent,
  SonarrCalendarEntry,
  RadarrCalendarEntry,
} from '@/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    let start = searchParams.get('start');
    let end = searchParams.get('end');
    const days = searchParams.get('days');
    const type = searchParams.get('type');

    // If days provided without start/end, calculate from today
    if (!start || !end) {
      const daysNum = days ? parseInt(days, 10) : 30;
      const now = new Date();
      start = now.toISOString();
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() + daysNum);
      end = endDate.toISOString();
    }

    const events: CalendarEvent[] = [];

    // Fetch from Sonarr and Radarr in parallel
    const [sonarrResult, radarrResult] = await Promise.allSettled([
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
    ]);

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
        });
      }
    }

    // Transform Radarr movies
    if (radarrResult.status === 'fulfilled') {
      for (const m of radarrResult.value) {
        events.push({
          id: `radarr-${m.id}`,
          type: 'movie',
          title: m.title,
          subtitle: `${m.year} - ${m.studio}`,
          date: m.digitalRelease || m.physicalRelease || m.inCinemas,
          hasFile: m.hasFile,
          monitored: m.monitored,
          movieId: m.id,
          images: m.images,
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
