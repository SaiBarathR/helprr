// Upcoming episodes, movie releases and albums, before they air or as a daily digest, each once.
import { prisma } from '@/lib/db';
import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import { TZDate } from '@date-fns/tz';
import { startOfLocalDay, endOfLocalDay, toZonedDate, getLocalDateKey, normalizeTimeZone } from '@/lib/timezone';
import { releaseDayKey } from '@/lib/release-day';
import { logger } from '@/lib/logger';
import { noteJobFailure, noteJobSkipped } from '@/lib/polling-job-report';
import { PollNotificationCollector } from '@/lib/notification-grouping';
import { usersWhoCouldReceive } from '@/lib/notification-service';
import { notifyAndLog, instanceTitle, type CycleContext } from './shared';

// Tolerance (minutes) for the "before_air" firing window. Lets a sluggish poll
// still catch an item that just slipped past its computed notify time —
// important for the "0 min / at air time" case, where the notify moment is
// the air moment itself.
const BEFORE_AIR_GRACE_MIN = 5;
// Extra calendar fetch padding past notifyBeforeMins so an item near the upper
// edge isn't excluded by clock skew between us and Sonarr/Radarr.
const FETCH_END_BUFFER_MS = 60_000;

const HOUR_MS = 3_600_000;

/** The moment a release day ("2026-11-20") starts in a time zone. */
function localMidnightMs(dayKey: string, timeZone: string): number {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new TZDate(year, month - 1, day, 0, 0, 0, 0, timeZone).getTime();
}

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

  // A film or album release is a day, given as its UTC midnight (release-day.ts).
  // The digest takes the releases dated today: by instant, the local day west of
  // UTC held tomorrow's. Before-air counts down to that day's local midnight in
  // each recipient zone (UTC midnight was 5:30 AM in India, 4 PM the day before
  // in LA). Radarr and Lidarr are asked for a day more on each side so these
  // come back wherever their UTC midnight falls.
  const digestDay = mode === 'daily_digest' ? getLocalDateKey(now, timeZone) : null;
  const releaseStart = new Date(fetchStartMs - 86_400_000).toISOString();
  const releaseEnd = new Date(fetchEndMs + 86_400_000).toISOString();

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
  // rows can't match a key we build this cycle. Release keys need more: a
  // before-air push leaves up to 14 h (UTC+14) plus the lead before its day's
  // UTC midnight, and a digest for that day can run until 23:59 in UTC-12, 36 h
  // after it, so about 50 h plus the lead; 2 days + 2 h covers it. The
  // snapshot doesn't see rows written later in this same cycle, so we also
  // record each key as we fire it (notifiedKeys.add below) — that suppresses a
  // duplicate calendar entry that a malformed/proxied upstream might repeat
  // within one response.
  const dedupeLookbackMs =
    (settings.upcomingNotifyBeforeMins + BEFORE_AIR_GRACE_MIN) * 60_000 +
    FETCH_END_BUFFER_MS +
    2 * 86_400_000 + 2 * HOUR_MS;
  const priorUpcoming = await prisma.notificationHistory.findMany({
    where: {
      eventType: 'upcomingPremiere',
      createdAt: { gte: new Date(now.getTime() - dedupeLookbackMs) },
    },
    select: { dedupeKey: true, body: true, metadata: true },
  });
  const notifiedKeys = new Set<string>();
  const notifiedBodies = new Set<string>();
  // Who each film or album release (by its bare key) has already gone to:
  // 'all' after a broadcast (the digest, the old UTC-midnight countdown, or a
  // household whose midnight is one instant), else the users of its targeted
  // sends ("<key>@<instant>", their ids in metadata.recipientUserIds). So a
  // user who changes time zone after their send is not sent it again.
  const releaseCoverage = new Map<string, 'all' | Set<string>>();
  const cover = (key: string, recipients: unknown) => {
    const at = key.lastIndexOf('@');
    const base = at > 0 ? key.slice(0, at) : key;
    const previous = releaseCoverage.get(base);
    if (previous === 'all') return;
    if (at <= 0 || !Array.isArray(recipients)) {
      releaseCoverage.set(base, 'all');
      return;
    }
    const ids = recipients.filter((id): id is string => typeof id === 'string');
    releaseCoverage.set(base, new Set([...(previous ?? []), ...ids]));
  };
  for (const row of priorUpcoming) {
    const md = row.metadata as { grouped?: unknown; itemDedupeKeys?: unknown; recipientUserIds?: unknown } | null;
    if (row.dedupeKey) {
      notifiedKeys.add(row.dedupeKey);
      cover(row.dedupeKey, md?.recipientUserIds);
      continue;
    }
    // A grouped row has no top-level dedupeKey; its per-item keys live in
    // metadata.itemDedupeKeys (see notification-grouping.ts). Harvest them so
    // items sent inside a digest are still suppressed on later cycles.
    if (md?.grouped && Array.isArray(md.itemDedupeKeys)) {
      for (const key of md.itemDedupeKeys) {
        if (typeof key !== 'string') continue;
        notifiedKeys.add(key);
        cover(key, md.recipientUserIds);
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
  /** Whether any moment between the two could fire now. */
  const shouldFireBeforeAirBetween = (earliestMs: number, latestMs: number): boolean =>
    latestMs >= now.getTime() - BEFORE_AIR_GRACE_MIN * 60_000 &&
    earliestMs <= now.getTime() + settings.upcomingNotifyBeforeMins * 60_000;

  // The sends a film or album release is due this cycle. The digest sends
  // today's once, under the release's own key (`baseKey`), unless before-air
  // already sent it. Before-air plans for the users who could receive it (the
  // delivery's gates) and counts down to the day's midnight in each one's zone
  // (their own, else the app's); users whose midnight is the same instant
  // (Asia/Kolkata and Asia/Calcutta, or UTC and London in winter) share one send
  // and one history row, keyed "<baseKey>@<instant>". A household on one instant
  // gets one broadcast, as before. A release nobody could receive is still
  // broadcast once at the app zone's midnight, so Notifications lists it.
  const recipientsBySource = new Map<string, Promise<Array<{ id: string; timeZone: string }>>>();
  const recipientsFor = (source: 'radarr' | 'lidarr') => {
    let recipients = recipientsBySource.get(source);
    if (!recipients) {
      recipients = usersWhoCouldReceive('upcomingPremiere', { source }).then((users) =>
        users.map((user) => ({ id: user.id, timeZone: normalizeTimeZone(user.timeZone, timeZone) })));
      recipientsBySource.set(source, recipients);
    }
    return recipients;
  };
  const releaseSends = async (
    dateStr: string,
    baseKey: string,
    source: 'radarr' | 'lidarr',
  ): Promise<Array<{ dedupeKey: string; userIds?: string[] }>> => {
    const day = releaseDayKey(dateStr);
    if (!day) return [];
    const covered = releaseCoverage.get(baseKey);
    if (digestDay) return day === digestDay && !covered ? [{ dedupeKey: baseKey }] : [];
    if (covered === 'all') return [];
    // Local midnights fall from 14 h before the UTC midnight to 12 h after it:
    // when none of them can be in the window, there is nobody to look up.
    const utcMidnightMs = localMidnightMs(day, 'UTC');
    if (!shouldFireBeforeAirBetween(utcMidnightMs - 14 * HOUR_MS, utcMidnightMs + 12 * HOUR_MS)) return [];
    const byInstant = new Map<number, string[]>();
    for (const { id, timeZone: zone } of await recipientsFor(source)) {
      const at = localMidnightMs(day, zone);
      byInstant.set(at, [...(byInstant.get(at) ?? []), id]);
    }
    if (byInstant.size === 0) byInstant.set(localMidnightMs(day, timeZone), []);
    const broadcast = byInstant.size === 1 && !covered;
    const sends: Array<{ dedupeKey: string; userIds?: string[] }> = [];
    for (const [at, ids] of byInstant) {
      if (!shouldFireBeforeAir(at)) continue;
      const userIds = covered ? ids.filter((id) => !covered.has(id)) : ids;
      if (broadcast) sends.push({ dedupeKey: `${baseKey}@${at}` });
      else if (userIds.length > 0) sends.push({ dedupeKey: `${baseKey}@${at}`, userIds });
    }
    return sends;
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
    const calendar = await client.getCalendar(releaseStart, releaseEnd);
    logger.debug('Radarr upcoming calendar polled', {
      instanceId: connection.id,
      calendarCount: calendar.length,
      start: releaseStart,
      end: releaseEnd,
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

        const body = `${movie.title} (${movie.year}) — ${releaseTypeLabels[releaseType]}`;
        const baseKey = `radarr-${connection.id}-${movie.id}-${releaseType}-${releaseMs}`;
        const legacyKey = `radarr-${movie.id}-${releaseType}-${releaseMs}`;

        // Radarr returns a movie if ANY of its 3 release dates falls in the
        // window, so the other two might be years away (e.g., cinema 2010,
        // digital today); those have no send.
        for (const { dedupeKey, userIds } of await releaseSends(dateStr, baseKey, 'radarr')) {
          if (alreadyNotified([dedupeKey, ...(connection.isDefault ? [legacyKey] : [])], body)) {
            logger.debug('Skipping duplicate Radarr upcoming notification', {
              movieId: movie.id,
              releaseType,
              dedupeKey,
            }, { scope: 'polling' });
            continue;
          }

          notifiedKeys.add(dedupeKey);
          cover(dedupeKey, userIds);
          collector.add({
            eventType: 'upcomingPremiere',
            title: instanceTitle('Upcoming Movie', connection.label, radarrClients.length),
            body,
            dedupeKey,
            ...(userIds ? { userIds } : {}),
            metadata: {
              ...(userIds ? { recipientUserIds: userIds } : {}),
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
    const calendar = await client.getCalendar(releaseStart, releaseEnd);
    logger.debug('Lidarr upcoming calendar polled', {
      instanceId: connection.id,
      calendarCount: calendar.length,
      start: releaseStart,
      end: releaseEnd,
      mode,
    }, { scope: 'polling' });
    for (const album of calendar) {
      if (!album.releaseDate) continue;
      const releaseMs = new Date(album.releaseDate).getTime();
      if (!Number.isFinite(releaseMs)) continue;
      const artistName = album.artist?.artistName ?? '';
      const body = `${artistName ? `${artistName} — ` : ''}${album.title}`;
      const baseKey = `lidarr-${connection.id}-${album.id}-${releaseMs}`;
      const legacyKey = `lidarr-${album.id}-${releaseMs}`;
      for (const { dedupeKey, userIds } of await releaseSends(album.releaseDate, baseKey, 'lidarr')) {
        if (alreadyNotified([dedupeKey, ...(connection.isDefault ? [legacyKey] : [])], body)) continue;

        notifiedKeys.add(dedupeKey);
        cover(dedupeKey, userIds);
        collector.add({
          eventType: 'upcomingPremiere',
          title: instanceTitle('Upcoming Album', connection.label, lidarrClients.length),
          body,
          dedupeKey,
          ...(userIds ? { userIds } : {}),
          metadata: {
            ...(userIds ? { recipientUserIds: userIds } : {}),
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
    }
  } catch (error) {
    noteJobFailure(error);
    logger.warn('Lidarr upcoming calendar poll failed', error, { scope: 'polling' });
  }
  }

  await collector.flush({ enabled: settings.notificationGroupingEnabled, notify: notifyAndLog });
}
