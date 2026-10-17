// Scheduled alerts section of a settings import.

import type { Prisma, ScheduledAlert } from '@prisma/client';
import { isValidTimeZone } from '@/lib/timezone';
import { isAlertScope, isScheduleMode, parseReleaseTypes } from '@/lib/scheduled-alerts/helpers';
import { DEFAULT_OFFSET_MINUTES } from '@/lib/scheduled-alerts/constants';
import { isValidMediaType, isValidSource } from '@/lib/watchlist-helpers';
import { validateImportedPosterUrl } from './shared';

/**
 * Restore scheduled-alert rules for one user. Occurrences are NOT imported:
 * an absolute alert's single occurrence is recreated here from absoluteNotifyAt
 * (skipped when that time has already passed — the alert would never fire), and
 * release_relative alerts are pushed to `createdReleaseRelative` so the caller
 * resolves their occurrences after the transaction commits — resolution hits
 * external APIs and must not run inside the transaction.
 */
export async function applyScheduledAlertsInTxn(
  tx: Prisma.TransactionClient,
  alerts: unknown[],
  skipped: string[],
  ownerUserId: string,
  ownerLabel: string,
  createdReleaseRelative: ScheduledAlert[],
): Promise<number> {
  let applied = 0;
  const instanceExists = new Map<string, boolean>();
  for (const raw of alerts) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const source = typeof a.source === 'string' ? a.source.toUpperCase() : '';
    const mediaType = typeof a.mediaType === 'string' ? a.mediaType.toLowerCase() : '';
    const externalId = typeof a.externalId === 'string' ? a.externalId.trim() : '';
    const title = typeof a.title === 'string' ? a.title.trim().slice(0, 200) : '';
    const scheduleMode = typeof a.scheduleMode === 'string' ? a.scheduleMode : '';
    if (
      !isValidSource(source) ||
      !isValidMediaType(mediaType) ||
      !externalId ||
      !title ||
      !isScheduleMode(scheduleMode)
    ) {
      skipped.push(`${ownerLabel}: alert skipped (missing or invalid fields)`);
      continue;
    }
    const scope =
      typeof a.scope === 'string' && isAlertScope(a.scope)
        ? a.scope
        : mediaType === 'movie' ? 'movie' : mediaType === 'anime' ? 'anime' : 'series';
    const releaseTypes = parseReleaseTypes(a.releaseTypes);
    const offsetMinutes =
      typeof a.offsetMinutes === 'number' && Number.isFinite(a.offsetMinutes)
        ? Math.max(0, Math.min(10_080, Math.round(a.offsetMinutes)))
        : DEFAULT_OFFSET_MINUTES;
    const timeZone =
      typeof a.timeZone === 'string' && isValidTimeZone(a.timeZone) ? a.timeZone : 'UTC';

    let absoluteNotifyAt: Date | null = null;
    if (scheduleMode === 'absolute') {
      const at = typeof a.absoluteNotifyAt === 'string' ? new Date(a.absoluteNotifyAt) : null;
      if (!at || !Number.isFinite(at.getTime()) || at.getTime() < Date.now() - 60_000) {
        skipped.push(`${ownerLabel}: "${title}" skipped (custom reminder time already passed)`);
        continue;
      }
      absoluteNotifyAt = at;
    }

    // Instance ids are install-local; keep only if that connection still exists.
    let instanceId = typeof a.instanceId === 'string' && a.instanceId ? a.instanceId : null;
    if (instanceId) {
      let ok = instanceExists.get(instanceId);
      if (ok === undefined) {
        ok = Boolean(
          await tx.serviceConnection.findUnique({ where: { id: instanceId }, select: { id: true } })
        );
        instanceExists.set(instanceId, ok);
      }
      if (!ok) instanceId = null;
    }

    // Idempotent re-import: an equivalent active rule already covers this target.
    const existing = await tx.scheduledAlert.findFirst({
      where: { userId: ownerUserId, source, externalId, mediaType, scope, scheduleMode, status: 'active' },
      select: { id: true },
    });
    if (existing) continue;

    // Only the known resolver-targeting keys survive; anything else is dropped.
    const metadata: Record<string, number> = {};
    const metaRaw =
      a.metadata && typeof a.metadata === 'object' && !Array.isArray(a.metadata)
        ? (a.metadata as Record<string, unknown>)
        : null;
    if (metaRaw) {
      for (const key of ['seasonNumber', 'episodeId', 'seriesId', 'movieId'] as const) {
        const v = metaRaw[key];
        if (typeof v === 'number' && Number.isFinite(v)) metadata[key] = Math.round(v);
      }
    }

    const subtitle = typeof a.subtitle === 'string' && a.subtitle ? a.subtitle.slice(0, 500) : null;
    const posterUrl =
      typeof a.posterUrl === 'string' && a.posterUrl ? validateImportedPosterUrl(a.posterUrl) : null;
    // hrefs are in-app paths; reject anything that could leave the app.
    const href =
      typeof a.href === 'string' && a.href.startsWith('/') && !a.href.startsWith('//')
        ? a.href.slice(0, 500)
        : null;

    const created = await tx.scheduledAlert.create({
      data: {
        userId: ownerUserId,
        source,
        externalId,
        mediaType,
        instanceId,
        title,
        subtitle,
        posterUrl,
        href,
        scheduleMode,
        scope,
        releaseTypes: releaseTypes as unknown as Prisma.InputJsonValue,
        offsetMinutes,
        timeZone,
        metadata: metadata as unknown as Prisma.InputJsonValue,
      },
    });
    if (scheduleMode === 'absolute' && absoluteNotifyAt) {
      // Mirrors POST /api/scheduled-alerts' absolute-occurrence shape.
      await tx.scheduledAlertOccurrence.create({
        data: {
          alertId: created.id,
          releaseAt: absoluteNotifyAt,
          notifyAt: absoluteNotifyAt,
          releaseKind: 'custom',
          targetKey: `custom:${source}:${externalId}`,
          title,
          body: subtitle ?? title,
        },
      });
    } else if (scheduleMode === 'release_relative') {
      createdReleaseRelative.push(created);
    }
    applied += 1;
  }
  return applied;
}
