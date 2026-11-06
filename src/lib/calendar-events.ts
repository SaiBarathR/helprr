import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
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

/**
 * Fetch from every instance of Sonarr, Radarr and Lidarr in parallel, tagging
 * each event with its instance so detail links resolve to the right one. An
 * unreachable instance is skipped. Shared by the calendar page's API and the
 * subscribable feed, so both show the same events.
 */
export async function fetchServiceCalendarEvents(start: string, end: string): Promise<ServiceCalendarResult> {
  const events: CalendarEvent[] = [];
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();

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
        const entries = await client.getCalendar(start, end);
        anyOk = true;
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
        const entries = await client.getCalendar(start, end);
        anyOk = true;
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

  const totalInstances = sonarrClients.length + radarrClients.length + lidarrClients.length;
  return { events, cacheable: anyOk || totalInstances === 0 };
}
