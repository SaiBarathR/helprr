import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { notifyEvent } from '@/lib/notification-service';
import { MAX_REMINDER_ATTEMPTS } from '@/lib/scheduled-alerts/constants';
import { resolveHref } from '@/lib/scheduled-alerts/helpers';
import { createResolverContext, resolveAlertOccurrencesResult } from '@/lib/scheduled-alerts/resolver';
import type { OccurrenceCandidate, ScheduledAlertMetadata, UpcomingAlbum } from '@/lib/scheduled-alerts/types';
import type { ScheduledAlert, Prisma } from '@prisma/client';
import { noteJobFailure, noteJobSkipped } from '@/lib/polling-job-report';
import { can, type PermissionUser } from '@/lib/permissions';

type DbClient = Prisma.TransactionClient | typeof prisma;

const DAY_MS = 24 * 60 * 60 * 1000;
// Moving film reminders from midnight UTC to 9:00 local shifts them by at most
// 21 hours (UTC−12); a release really moved a day is 23 hours or more (DST).
const SAME_RELEASE_SHIFT_MS = 22 * 60 * 60 * 1000;
// TMDB and Radarr (or two instances) often date the same release a day apart.
const OTHER_SOURCE_SHIFT_MS = 2 * DAY_MS;

/**
 * Which release an occurrence announces, whatever source or instance it came
 * from: a film's cinema/digital/physical release (one film per alert), an
 * episode by its code, else its target key. A Discover film that moves from
 * TMDB to Radarr, or a series from TMDB to Sonarr, keeps the same identity.
 */
function releaseIdentity(o: { targetKey: string; releaseKind: string; metadata?: unknown }): string {
  if (o.releaseKind === 'cinema' || o.releaseKind === 'digital' || o.releaseKind === 'physical') return `film:${o.releaseKind}`;
  const m = (o.metadata ?? {}) as { seasonNumber?: unknown; episodeNumber?: unknown };
  if (o.releaseKind === 'episode' && Number.isInteger(m.seasonNumber) && Number.isInteger(m.episodeNumber)) {
    return `episode:${m.seasonNumber}:${m.episodeNumber}`;
  }
  return o.targetKey;
}

export async function upsertOccurrencesForAlert(
  alert: ScheduledAlert,
  candidates: OccurrenceCandidate[],
  opts: { resolved?: boolean; db?: DbClient } = {},
): Promise<void> {
  const db = opts.db ?? prisma;
  const now = new Date();
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 90);

  const validKeys = new Set(
    candidates
      .filter((c) => c.notifyAt >= now && c.notifyAt <= horizon)
      .map((c) => `${c.targetKey}|${c.notifyAt.toISOString()}`),
  );

  // A release already announced is not announced again when its time moved
  // by under 22 hours (film reminders moved from midnight UTC to 9:00 local,
  // an air time shifted by hours). The same release time means the notice was
  // edited, and a move of a day or more is a new date: both are announced.
  // The same release from another source or instance (a Discover film added
  // to Radarr after its push) is not announced again within two days.
  const sent = candidates.length > 0
    ? await db.scheduledAlertOccurrence.findMany({
        where: { alertId: alert.id, status: 'sent', releaseAt: { gte: new Date(now.getTime() - 2 * DAY_MS) } },
        select: { targetKey: true, releaseKind: true, releaseAt: true, metadata: true },
      })
    : [];
  const alreadySent = (c: OccurrenceCandidate) => {
    if (c.releaseAt === null) return false;
    const identity = releaseIdentity(c);
    return sent.some((o) => {
      if (o.releaseAt === null || releaseIdentity(o) !== identity) return false;
      const shift = Math.abs(o.releaseAt.getTime() - c.releaseAt!.getTime());
      if (o.targetKey !== c.targetKey) return shift <= OTHER_SOURCE_SHIFT_MS;
      return shift > 0 && shift < SAME_RELEASE_SHIFT_MS;
    });
  };

  for (const c of candidates) {
    if (c.notifyAt < now || c.notifyAt > horizon) continue;
    if (alreadySent(c)) continue;
    await db.scheduledAlertOccurrence.upsert({
      where: {
        alertId_targetKey_notifyAt: {
          alertId: alert.id,
          targetKey: c.targetKey,
          notifyAt: c.notifyAt,
        },
      },
      create: {
        alertId: alert.id,
        releaseAt: c.releaseAt,
        notifyAt: c.notifyAt,
        releaseKind: c.releaseKind,
        targetKey: c.targetKey,
        title: c.title,
        body: c.body,
        metadata: (c.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        status: 'pending',
      },
      update: {
        releaseAt: c.releaseAt,
        title: c.title,
        body: c.body,
        metadata: (c.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        // Restore stale-cancelled rows on automated refresh/create/update paths.
        // User-cancelled rows with the same key may also be restored (accepted tradeoff).
        status: 'pending',
        cancelledAt: null,
      },
    });
  }

  if (opts.resolved) {
    const pending = await db.scheduledAlertOccurrence.findMany({
      where: { alertId: alert.id, status: 'pending', notifyAt: { gte: now } },
    });
    const staleIds =
      validKeys.size === 0
        ? pending.map((o) => o.id)
        : pending
            .filter((o) => !validKeys.has(`${o.targetKey}|${o.notifyAt.toISOString()}`))
            .map((o) => o.id);
    if (staleIds.length > 0) {
      await db.scheduledAlertOccurrence.updateMany({
        where: { id: { in: staleIds } },
        data: { status: 'cancelled', cancelledAt: now },
      });
    }
  }
}

// Enough for years of an artist's announcements; the oldest are dropped first.
const MAX_KNOWN_ALBUM_KEYS = 500;

/**
 * An artist alert also tells its owner as soon as Lidarr learns of an album
 * ahead: each album not seen at an earlier resolve gets a push now. The first
 * resolve only records the albums Lidarr already knows. Seen albums are kept
 * even when an instance does not answer, so its albums are not announced twice.
 *
 * The seen list and the pushes are written together, and only while the alert
 * is unchanged since it was read: an edit and a background refresh resolving
 * at the same time cannot both announce the same album.
 */
export async function announceNewAlbums(
  alert: ScheduledAlert,
  upcoming: UpcomingAlbum[],
  db: DbClient = prisma,
): Promise<void> {
  const metadata = (alert.metadata ?? {}) as ScheduledAlertMetadata;
  const known = metadata.knownAlbumKeys ? new Set(metadata.knownAlbumKeys) : null;
  const fresh = known ? upcoming.filter((album) => !known.has(album.key)) : [];
  if (known && fresh.length === 0) return;
  const knownAlbumKeys = [...new Set([...(known ?? []), ...upcoming.map((album) => album.key)])].slice(-MAX_KNOWN_ALBUM_KEYS);
  const now = new Date();
  const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: alert.timeZone });

  const write = async (tx: DbClient) => {
    const { count } = await tx.scheduledAlert.updateMany({
      where: { id: alert.id, updatedAt: alert.updatedAt },
      data: { metadata: { ...metadata, knownAlbumKeys } as Prisma.InputJsonValue },
    });
    if (count === 0) return; // Changed since it was read: that resolve announces instead.
    for (const album of fresh) {
      await tx.scheduledAlertOccurrence.create({
        data: {
          alertId: alert.id,
          releaseAt: album.releaseAt,
          notifyAt: now,
          releaseKind: 'album',
          targetKey: `lidarr:${album.key}:announced`,
          title: album.artistName,
          body: `New album: ${album.title}, out ${day.format(album.releaseAt)}`,
        },
      });
    }
  };
  // Inside a caller's transaction, write there; otherwise in one of our own.
  await (db === prisma ? prisma.$transaction(write) : write(db));
}

/** A Lidarr alert reads the music library, so its owner must still have music.view. */
function ownerMaySee(alert: Pick<ScheduledAlert, 'source'> & { user: PermissionUser }): boolean {
  return alert.source !== 'LIDARR' || can(alert.user, 'music.view');
}

const OWNER_PERMISSIONS = { select: { role: true, template: true, permissions: true } } as const;

// How long a refreshed alert is left alone before it's re-resolved. Each
// refresh does upstream lookups + DB writes per alert, so without this gate
// every active alert churns on every poll cycle for nothing new (releases
// don't move minute-to-minute). updatedAt is bumped after each refresh (and
// by user edits — those paths resolve occurrences themselves), so filtering
// on it gives a cheap "not refreshed recently" gate.
const REFRESH_MIN_INTERVAL_MS = 15 * 60_000;

export async function refreshScheduledAlertOccurrences(): Promise<void> {
  const alerts = await prisma.scheduledAlert.findMany({
    where: {
      status: 'active',
      scheduleMode: 'release_relative',
      updatedAt: { lt: new Date(Date.now() - REFRESH_MIN_INTERVAL_MS) },
    },
    take: 100,
    orderBy: { updatedAt: 'asc' },
    include: { user: OWNER_PERMISSIONS },
  });
  if (alerts.length === 0) {
    noteJobSkipped();
    return;
  }

  const ctx = createResolverContext({
    maxOffsetMinutes: Math.max(...alerts.map((alert) => alert.offsetMinutes)),
  });
  for (const { user, ...alert } of alerts) {
    try {
      // An owner who lost music.view gets no more music reminders; Lidarr is not asked.
      const maySee = ownerMaySee({ ...alert, user });
      const { candidates, resolved, upcomingAlbums } = maySee
        ? await resolveAlertOccurrencesResult(alert, ctx)
        : { candidates: [], resolved: true, upcomingAlbums: undefined };
      // Unresolved means a release source it needs did not answer.
      if (!resolved) noteJobFailure(new Error('A release source for a scheduled alert did not answer'));
      await upsertOccurrencesForAlert(alert, candidates, { resolved });
      if (resolved && upcomingAlbums) await announceNewAlbums(alert, upcomingAlbums);
      // Only while unchanged since read: an edit or announcement already moved it,
      // and bumping over an edit would stop the edit's own announcement.
      const metadata = (alert.metadata ?? {}) as ScheduledAlertMetadata;
      const { knownAlbumKeys, ...withoutKnown } = metadata;
      await prisma.scheduledAlert.updateMany({
        where: { id: alert.id, updatedAt: alert.updatedAt },
        data: {
          updatedAt: new Date(),
          // Without music.view the seen albums go stale: start afresh, so regaining
          // it records what Lidarr knows instead of announcing it all at once.
          ...(!maySee && knownAlbumKeys ? { metadata: withoutKnown as Prisma.InputJsonValue } : {}),
        },
      });
    } catch (error) {
      noteJobFailure(error);
      logger.warn('Failed to refresh scheduled alert occurrences', { alertId: alert.id, error }, { scope: 'polling' });
    }
  }
}

export async function checkScheduledAlerts(): Promise<void> {
  const now = new Date();
  const due = await prisma.scheduledAlertOccurrence.findMany({
    where: {
      status: 'pending',
      notifyAt: { lte: now },
      attempts: { lt: MAX_REMINDER_ATTEMPTS },
      alert: { status: 'active' },
    },
    include: { alert: { include: { user: OWNER_PERMISSIONS } } },
    take: 50,
    orderBy: { notifyAt: 'asc' },
  });
  if (due.length === 0) {
    noteJobSkipped();
    return;
  }

  for (const occ of due) {
    const alert = occ.alert;
    if (!ownerMaySee(alert)) {
      await prisma.scheduledAlertOccurrence.update({
        where: { id: occ.id },
        data: { status: 'cancelled', cancelledAt: now },
      });
      continue;
    }
    const redirect =
      alert.href ??
      resolveHref({
        source: alert.source as never,
        externalId: alert.externalId,
        mediaType: alert.mediaType as never,
        title: alert.title,
      }) ??
      '/notifications/scheduled';

    const meta = (occ.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.redirect !== 'string') meta.redirect = redirect;

    let delivered = false;
    try {
      await notifyEvent({
        eventType: 'scheduledAlert',
        // The occurrence title carries the media name (resolver/creation always
        // set it); the body carries the release detail (e.g. "S03E01 - …").
        title: occ.title || alert.title,
        body: occ.body ?? alert.subtitle ?? occ.title,
        metadata: {
          ...meta,
          scheduledAlertId: alert.id,
          scheduledOccurrenceId: occ.id,
          mediaType: alert.mediaType,
          releaseKind: occ.releaseKind,
          releaseAt: occ.releaseAt?.toISOString(),
          redirect,
        },
        url: redirect,
        dedupeKey: `scheduled:${occ.id}`,
        userIds: [alert.userId],
        ownerUserId: alert.userId,
      });
      // notifyEvent writes in-app history even when there are no eligible push
      // subscriptions, matching the legacy watchlist reminder semantics.
      delivered = true;
    } catch (error) {
      noteJobFailure(error);
      logger.warn('Scheduled alert push failed', { occurrenceId: occ.id, error }, { scope: 'polling' });
    }

    const nextAttempts = occ.attempts + 1;
    const giveUp = !delivered && nextAttempts >= MAX_REMINDER_ATTEMPTS;
    await prisma.scheduledAlertOccurrence.update({
      where: { id: occ.id },
      data: {
        attempts: nextAttempts,
        lastAttemptAt: now,
        status: delivered || giveUp ? (delivered ? 'sent' : 'failed') : 'pending',
        sentAt: delivered ? now : occ.sentAt,
      },
    });
  }
}
