import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import { can, type PermissionUser } from '@/lib/permissions';
import { releaseDayKey } from '@/lib/release-day';
import { getLocalDateKey } from '@/lib/timezone';
import type { CalendarEvent, MovieReleaseType } from '@/types';

export interface ServiceCalendarResult {
  /** Every Sonarr, Radarr and Lidarr event in the window, sorted by date. */
  events: CalendarEvent[];
  /**
   * Safe to cache: at least one instance answered, or none is configured. A
   * transient all-instances-failed fetch must not blank the calendar for the TTL.
   */
  cacheable: boolean;
}

const DAY_MS = 86_400_000;

/**
 * Fetch from every instance of Sonarr, Radarr and Lidarr in parallel, tagging
 * each event with its instance so detail links resolve to the right one. An
 * unreachable instance is skipped. Shared by the calendar page's API and the
 * subscribable feed, so both show the same events.
 *
 * Episodes are in the window by their air time. A film or album release is a
 * day (see release-day.ts), in the window when that day is one of the window's
 * days in `timeZone`: by instant, the window's first day lost its releases west
 * of UTC and gained the next day's east of it. Radarr and Lidarr are asked for
 * a day more on each side so those releases come back to be checked.
 */
export async function fetchServiceCalendarEvents(start: string, end: string, timeZone: string): Promise<ServiceCalendarResult> {
  const events: CalendarEvent[] = [];
  const firstDay = getLocalDateKey(start, timeZone);
  const lastDay = getLocalDateKey(end, timeZone);
  const inWindow = (dateStr: string | undefined) => {
    const day = releaseDayKey(dateStr);
    return day !== null && day >= firstDay && day <= lastDay;
  };
  const releaseStart = new Date(new Date(start).getTime() - DAY_MS).toISOString();
  const releaseEnd = new Date(new Date(end).getTime() + DAY_MS).toISOString();

  const [sonarrClients, radarrClients, lidarrClients] = await Promise.all([
    getSonarrClients().catch(() => []),
    getRadarrClients().catch(() => []),
    getLidarrClients().catch(() => []),
  ]);

  let anyOk = false;
  await Promise.all([
    ...sonarrClients.map(async ({ connection, client }) => {
      try {
        const entries = await client.getCalendar(start, end);
        anyOk = true;
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
            ...(ep.series.runtime > 0 ? { runtime: ep.series.runtime } : {}),
          });
        }
      } catch {
        // Skip unreachable instance.
      }
    }),
    ...radarrClients.map(async ({ connection, client }) => {
      try {
        const entries = await client.getCalendar(releaseStart, releaseEnd);
        anyOk = true;
        for (const m of entries) {
          const releases: Array<[MovieReleaseType, string | undefined]> = [
            ['cinema', m.inCinemas],
            ['physical', m.physicalRelease],
            ['digital', m.digitalRelease],
          ];
          for (const [releaseType, dateStr] of releases) {
            // Radarr returns a film when any of its dates is in the window.
            if (!dateStr || !inWindow(dateStr)) continue;
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
        const entries = await client.getCalendar(releaseStart, releaseEnd);
        anyOk = true;
        for (const album of entries) {
          if (!album.releaseDate || !inWindow(album.releaseDate)) continue;
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

  const totalInstances = sonarrClients.length + radarrClients.length + lidarrClients.length;
  return { events, cacheable: anyOk || totalInstances === 0 };
}

/**
 * Album releases are music: left out for a user without music.view, as the
 * Music pages and Activity are. Applied after the shared cache, which holds
 * every event for every viewer.
 */
export function calendarEventsFor(user: PermissionUser, events: CalendarEvent[]): CalendarEvent[] {
  return can(user, 'music.view') ? events : events.filter((event) => event.type !== 'album');
}
