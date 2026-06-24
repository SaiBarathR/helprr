import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { notifyEvent } from '@/lib/notification-service';
import { MAX_REMINDER_ATTEMPTS } from '@/lib/scheduled-alerts/constants';
import { resolveHref } from '@/lib/scheduled-alerts/helpers';
import { createResolverContext, resolveAlertOccurrencesResult } from '@/lib/scheduled-alerts/resolver';
import type { OccurrenceCandidate } from '@/lib/scheduled-alerts/types';
import type { ScheduledAlert, Prisma } from '@prisma/client';

type DbClient = Prisma.TransactionClient | typeof prisma;

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

  for (const c of candidates) {
    if (c.notifyAt < now || c.notifyAt > horizon) continue;
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

export async function refreshScheduledAlertOccurrences(): Promise<void> {
  const alerts = await prisma.scheduledAlert.findMany({
    where: { status: 'active', scheduleMode: 'release_relative' },
    take: 100,
    orderBy: { updatedAt: 'asc' },
  });
  if (alerts.length === 0) return;

  const ctx = createResolverContext({
    maxOffsetMinutes: Math.max(...alerts.map((alert) => alert.offsetMinutes)),
  });
  for (const alert of alerts) {
    try {
      const { candidates, resolved } = await resolveAlertOccurrencesResult(alert, ctx);
      await upsertOccurrencesForAlert(alert, candidates, { resolved });
      await prisma.scheduledAlert.update({
        where: { id: alert.id },
        data: { updatedAt: new Date() },
      });
    } catch (error) {
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
    include: { alert: true },
    take: 50,
    orderBy: { notifyAt: 'asc' },
  });
  if (due.length === 0) return;

  for (const occ of due) {
    const alert = occ.alert;
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
        title: 'Scheduled Alert',
        body: occ.body ?? occ.title,
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
