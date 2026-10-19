// Upcoming episodes, movie releases and albums, before they air or as a daily digest, each once.
import { prisma } from '@/lib/db';
import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import { startOfLocalDay, endOfLocalDay, toZonedDate } from '@/lib/timezone';
import { logger } from '@/lib/logger';
import { noteJobFailure, noteJobSkipped } from '@/lib/polling-job-report';
import { PollNotificationCollector } from '@/lib/notification-grouping';
import { notifyAndLog, instanceTitle, type CycleContext } from './shared';

// Tolerance (minutes) for the "before_air" firing window. Lets a sluggish poll
// still catch an item that just slipped past its computed notify time —
// important for the "0 min / at air time" case, where the notify moment is
// the air moment itself.
const BEFORE_AIR_GRACE_MIN = 5;
// Extra calendar fetch padding past notifyBeforeMins so an item near the upper
// edge isn't excluded by clock skew between us and Sonarr/Radarr.
const FETCH_END_BUFFER_MS = 60_000;


export async function checkUpcoming(context: CycleContext) {
  const settings = await context.getSettings();
  const timeZone = settings.timeZone;

  const mode: 'before_air' | 'daily_digest' =
    settings.upcomingNotifyMode === 'daily_digest' ? 'daily_digest' : 'before_air';
  const now = new Date(context.startedAtMs);
  logger.debug('Upcoming poll started', {
    mode,
    timeZone,
    dailyNotifyHour: settings.upcomingDailyNotifyHour,
    notifyBeforeMins: settings.upcomingNotifyBeforeMins,
  }, { scope: 'polling' });

  // Compute the calendar fetch window per mode:
  //   before_air   : [now - grace, now + notifyBeforeMins + buffer]
  //                  Grace lets "0 min / at air time" still fire when the
  //                  poll lands a few seconds after the air moment.
  //   daily_digest : the entire local calendar day, gated by hour. Per-item
  //                  dedupeKey prevents duplicates within the digest hour.
  let fetchStartMs: number;
  let fetchEndMs: number;

  if (mode === 'daily_digest') {
    const localHour = toZonedDate(now, timeZone).getHours();
    if (localHour !== settings.upcomingDailyNotifyHour) {
      logger.debug('Skipping upcoming daily digest outside configured hour', {
        localHour,
        dailyNotifyHour: settings.upcomingDailyNotifyHour,
        timeZone,
      }, { scope: 'polling' });
      noteJobSkipped();
      return;
    }

    // Per-item dedupeKey suppresses duplicates within the digest hour, so we
    // don't need a coarse "any-row-today → bail" guard. Removing it also
    // means a partial-failure digest can resume on the next poll instead of
    // locking out the rest of the day's items.
    fetchStartMs = startOfLocalDay(now, timeZone).getTime();
    fetchEndMs = endOfLocalDay(now, timeZone).getTime();
  } else {
    fetchStartMs = now.getTime() - BEFORE_AIR_GRACE_MIN * 60_000;
    fetchEndMs = now.getTime() + settings.upcomingNotifyBeforeMins * 60_000 + FETCH_END_BUFFER_MS;
  }

  const start = new Date(fetchStartMs).toISOString();
  const end = new Date(fetchEndMs).toISOString();

  // Helpers ----------------------------------------------------------------
  // For each candidate item we ask: "have we ever notified for this exact
  // (item, air-time) pair?" If not, fire. The dedupeKey embeds the full air
  // timestamp so any reschedule — even same-day — produces a fresh key and
  // a fresh notification. Body-string fallback preserves dedupe for rows
  // created before the migration added dedupeKey.
  //
  // Prefetch every recent upcomingPremiere row ONCE instead of a findFirst per
  // calendar item per instance (the old N+1, run every poll cycle). A matching
  // row was written when its item was last inside the notify window — at most
  // (notifyBefore + grace) before its air time, and the furthest air time we
  // consider is fetchEndMs — so look back that far plus a day of slack; older
  // rows can't match a key we build this cycle. The snapshot doesn't see rows
  // written later in this same cycle, so we also record each key as we fire it
  // (notifiedKeys.add below) — that suppresses a duplicate calendar entry that
  // a malformed/proxied upstream might repeat within one response.
  const dedupeLookbackMs =
    (settings.upcomingNotifyBeforeMins + BEFORE_AIR_GRACE_MIN) * 60_000 +
    FETCH_END_BUFFER_MS +
    86_400_000;
  const priorUpcoming = await prisma.notificationHistory.findMany({
    where: {
      eventType: 'upcomingPremiere',
      createdAt: { gte: new Date(now.getTime() - dedupeLookbackMs) },
    },
    select: { dedupeKey: true, body: true, metadata: true },
  });
  const notifiedKeys = new Set<string>();
  const notifiedBodies = new Set<string>();
  for (const row of priorUpcoming) {
    if (row.dedupeKey) {
      notifiedKeys.add(row.dedupeKey);
      continue;
    }
    // A grouped row has no top-level dedupeKey; its per-item keys live in
    // metadata.itemDedupeKeys (see notification-grouping.ts). Harvest them so
    // items sent inside a digest are still suppressed on later cycles.
    const md = row.metadata as { grouped?: unknown; itemDedupeKeys?: unknown } | null;
    if (md?.grouped && Array.isArray(md.itemDedupeKeys)) {
      for (const key of md.itemDedupeKeys) {
        if (typeof key === 'string') notifiedKeys.add(key);
      }
    } else {
      notifiedBodies.add(row.body);
    }
  }
  const alreadyNotified = (dedupeKeys: string[], body: string): boolean =>
    dedupeKeys.some((key) => notifiedKeys.has(key)) || notifiedBodies.has(body);

  // Collapse same-cycle premiere bursts (e.g. the daily-digest hour firing
  // every premiere of the day at once) into one grouped push per
  // (source, instance). Flushed after all three calendar sections; a failed
  // flush just re-fires next cycle because no history row was written.
  const collector = new PollNotificationCollector();

  const shouldFireBeforeAir = (airTimeMs: number): boolean => {
    const minsUntilAir = (airTimeMs - now.getTime()) / 60_000;
    return (
      minsUntilAir <= settings.upcomingNotifyBeforeMins &&
      minsUntilAir >= -BEFORE_AIR_GRACE_MIN
    );
  };

  // Sonarr calendar (every instance) ---------------------------------------
  // Client discovery is isolated per source (here and below) so one failure
  // can't abort the method before the collector flush and silently delay the
  // other sources' already-buffered notifications.
  let sonarrClients: Awaited<ReturnType<typeof getSonarrClients>> = [];
  try {
    sonarrClients = await getSonarrClients();
  } catch (error) {
    noteJobFailure(error);
    logger.warn('Skipping Sonarr upcoming poll because clients are unavailable', { error }, { scope: 'polling' });
  }
  for (const { connection, client } of sonarrClients) {
  try {
    const calendar = await client.getCalendar(start, end);
    logger.debug('Sonarr upcoming calendar polled', {
      instanceId: connection.id,
      calendarCount: calendar.length,
      start,
      end,
      mode,
    }, { scope: 'polling' });
    for (const ep of calendar) {
      if (!ep.series || !ep.airDateUtc) continue;
      const airTimeMs = new Date(ep.airDateUtc).getTime();
      if (!Number.isFinite(airTimeMs)) continue;

      // For daily_digest, the fetch already constrains to today, but keep a
      // defensive guard in case Sonarr returns an item outside the window.
      if (airTimeMs < fetchStartMs || airTimeMs > fetchEndMs) continue;

      if (mode === 'before_air' && !shouldFireBeforeAir(airTimeMs)) {
        logger.debug('Skipping Sonarr upcoming item outside before-air window', {
          seriesId: ep.seriesId,
          episodeId: ep.id,
          minsUntilAir: (airTimeMs - now.getTime()) / 60_000,
          notifyBeforeMins: settings.upcomingNotifyBeforeMins,
        }, { scope: 'polling' });
        continue;
      }

      const finaleLabel =
        ep.finaleType === 'series'
          ? 'Series Finale'
          : ep.finaleType === 'season'
            ? 'Season Finale'
            : ep.finaleType === 'midseason'
              ? 'Midseason Finale'
              : null;
      const baseBody = `${ep.series.title} S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')} - ${ep.title}`;
      const body = finaleLabel ? `${baseBody} (${finaleLabel})` : baseBody;
      const notificationTitle = ep.finaleType === 'series' ? 'Series Finale Airing Soon' : 'Upcoming Episode';
      const dedupeKey = `sonarr-${connection.id}-ep-${ep.id}-${airTimeMs}`;
      const legacyKey = `sonarr-ep-${ep.id}-${airTimeMs}`;

      if (alreadyNotified(connection.isDefault ? [dedupeKey, legacyKey] : [dedupeKey], body)) {
        logger.debug('Skipping duplicate Sonarr upcoming notification', {
          seriesId: ep.seriesId,
          episodeId: ep.id,
          dedupeKey,
        }, { scope: 'polling' });
        continue;
      }

      notifiedKeys.add(dedupeKey);
      collector.add({
        eventType: 'upcomingPremiere',
        title: instanceTitle(notificationTitle, connection.label, sonarrClients.length),
        body,
        dedupeKey,
        metadata: {
          source: 'sonarr',
          instanceId: connection.id,
          instanceLabel: connection.label,
          seriesId: ep.seriesId,
          seasonNumber: ep.seasonNumber,
          episodeId: ep.id,
          ...(ep.finaleType ? { finaleType: ep.finaleType } : {}),
          redirect: `/series/${ep.seriesId}/season/${ep.seasonNumber}/episode/${ep.id}?instance=${connection.id}`,
        },
        url: `/series/${ep.seriesId}?instance=${connection.id}`,
      }, {
        service: 'sonarr',
        reason: 'upcoming-premiere',
        seriesId: ep.seriesId,
        episodeId: ep.id,
        dedupeKey,
      });
    }
  } catch (error) {
    noteJobFailure(error);
    logger.warn('Sonarr upcoming calendar poll failed', error, { scope: 'polling' });
  }
  }

  // Radarr calendar (every instance) ---------------------------------------
  let radarrClients: Awaited<ReturnType<typeof getRadarrClients>> = [];
  try {
    radarrClients = await getRadarrClients();
  } catch (error) {
    noteJobFailure(error);
    logger.warn('Skipping Radarr upcoming poll because clients are unavailable', { error }, { scope: 'polling' });
  }
  for (const { connection, client } of radarrClients) {
  try {
    const calendar = await client.getCalendar(start, end);
    logger.debug('Radarr upcoming calendar polled', {
      instanceId: connection.id,
      calendarCount: calendar.length,
      start,
      end,
      mode,
    }, { scope: 'polling' });
    const releaseTypeLabels = {
      cinema: 'In Cinemas',
      physical: 'Physical Release',
      digital: 'Digital Release',
    } as const;
    for (const movie of calendar) {
      const releases: Array<['cinema' | 'physical' | 'digital', string | undefined]> = [
        ['cinema', movie.inCinemas],
        ['physical', movie.physicalRelease],
        ['digital', movie.digitalRelease],
      ];
      for (const [releaseType, dateStr] of releases) {
        if (!dateStr) continue;
        const releaseMs = new Date(dateStr).getTime();
        if (!Number.isFinite(releaseMs)) continue;

        // Skip release dates outside the fetch window. Radarr returns a
        // movie if ANY of its 3 release dates falls in the window, so the
        // other two might be years away (e.g., cinema 2010, digital today).
        if (releaseMs < fetchStartMs || releaseMs > fetchEndMs) continue;

        if (mode === 'before_air' && !shouldFireBeforeAir(releaseMs)) {
          logger.debug('Skipping Radarr upcoming item outside before-air window', {
            movieId: movie.id,
            releaseType,
            minsUntilAir: (releaseMs - now.getTime()) / 60_000,
            notifyBeforeMins: settings.upcomingNotifyBeforeMins,
          }, { scope: 'polling' });
          continue;
        }

        const body = `${movie.title} (${movie.year}) — ${releaseTypeLabels[releaseType]}`;
        const dedupeKey = `radarr-${connection.id}-${movie.id}-${releaseType}-${releaseMs}`;
        const legacyKey = `radarr-${movie.id}-${releaseType}-${releaseMs}`;

        if (alreadyNotified(connection.isDefault ? [dedupeKey, legacyKey] : [dedupeKey], body)) {
          logger.debug('Skipping duplicate Radarr upcoming notification', {
            movieId: movie.id,
            releaseType,
            dedupeKey,
          }, { scope: 'polling' });
          continue;
        }

        notifiedKeys.add(dedupeKey);
        collector.add({
          eventType: 'upcomingPremiere',
          title: instanceTitle('Upcoming Movie', connection.label, radarrClients.length),
          body,
          dedupeKey,
          metadata: {
            source: 'radarr',
            instanceId: connection.id,
            instanceLabel: connection.label,
            movieId: movie.id,
            releaseType,
            redirect: `/movies/${movie.id}?instance=${connection.id}`,
          },
          url: `/movies/${movie.id}?instance=${connection.id}`,
        }, {
          service: 'radarr',
          reason: 'upcoming-premiere',
          movieId: movie.id,
          releaseType,
          dedupeKey,
        });
      }
    }
  } catch (error) {
    noteJobFailure(error);
    logger.warn('Radarr upcoming calendar poll failed', error, { scope: 'polling' });
  }
  }

  // Lidarr calendar (every instance) ---------------------------------------
  let lidarrClients: Awaited<ReturnType<typeof getLidarrClients>> = [];
  try {
    lidarrClients = await getLidarrClients();
  } catch (error) {
    noteJobFailure(error);
    logger.warn('Skipping Lidarr upcoming poll because clients are unavailable', { error }, { scope: 'polling' });
  }
  for (const { connection, client } of lidarrClients) {
  try {
    const calendar = await client.getCalendar(start, end);
    logger.debug('Lidarr upcoming calendar polled', {
      instanceId: connection.id,
      calendarCount: calendar.length,
      start,
      end,
      mode,
    }, { scope: 'polling' });
    for (const album of calendar) {
      if (!album.releaseDate) continue;
      const releaseMs = new Date(album.releaseDate).getTime();
      if (!Number.isFinite(releaseMs)) continue;
      if (releaseMs < fetchStartMs || releaseMs > fetchEndMs) continue;
      if (mode === 'before_air' && !shouldFireBeforeAir(releaseMs)) continue;

      const artistName = album.artist?.artistName ?? '';
      const body = `${artistName ? `${artistName} — ` : ''}${album.title}`;
      const dedupeKey = `lidarr-${connection.id}-${album.id}-${releaseMs}`;
      const legacyKey = `lidarr-${album.id}-${releaseMs}`;
      if (alreadyNotified(connection.isDefault ? [dedupeKey, legacyKey] : [dedupeKey], body)) continue;

      notifiedKeys.add(dedupeKey);
      collector.add({
        eventType: 'upcomingPremiere',
        title: instanceTitle('Upcoming Album', connection.label, lidarrClients.length),
        body,
        dedupeKey,
        metadata: {
          source: 'lidarr',
          instanceId: connection.id,
          instanceLabel: connection.label,
          artistId: album.artistId,
          albumId: album.id,
          redirect: `/music/album/${album.id}?instance=${connection.id}`,
        },
        url: `/music/album/${album.id}?instance=${connection.id}`,
      }, {
        service: 'lidarr',
        reason: 'upcoming-premiere',
        albumId: album.id,
        dedupeKey,
      });
    }
  } catch (error) {
    noteJobFailure(error);
    logger.warn('Lidarr upcoming calendar poll failed', error, { scope: 'polling' });
  }
  }

  await collector.flush({ enabled: settings.notificationGroupingEnabled, notify: notifyAndLog });
}
