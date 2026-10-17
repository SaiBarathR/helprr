// Scheduled alerts section of a settings import. prepareScheduledAlerts
// validates and normalizes the file's alerts before the transaction opens; the
// apply step writes them with a fixed number of bulk statements.

import type { Prisma, ScheduledAlert } from '@prisma/client';
import { isValidTimeZone } from '@/lib/timezone';
import { isAlertScope, isScheduleMode, parseReleaseTypes } from '@/lib/scheduled-alerts/helpers';
import { DEFAULT_OFFSET_MINUTES } from '@/lib/scheduled-alerts/constants';
import { isValidMediaType, isValidSource } from '@/lib/watchlist-helpers';
import { validateImportedPosterUrl } from './shared';

// Rows per bulk statement, well inside PostgreSQL's bind-parameter limit.
const BATCH = 1_000;

interface PreparedAlert {
  source: string;
  externalId: string;
  mediaType: string;
  title: string;
  subtitle: string | null;
  posterUrl: string | null;
  href: string | null;
  scheduleMode: string;
  scope: string;
  releaseTypes: string[];
  offsetMinutes: number;
  timeZone: string;
  metadata: Record<string, number>;
  instanceId: string | null;
  absoluteNotifyAt: Date | null;
}

/** An active alert with the same key already covers the target; re-imports skip it. */
const alertKey = (a: Pick<PreparedAlert, 'source' | 'externalId' | 'mediaType' | 'scope' | 'scheduleMode'>) =>
  [a.source, a.externalId, a.mediaType, a.scope, a.scheduleMode].join('\u0000');

/** Validate and normalize one owner's alerts, keeping the first of any duplicates. */
export function prepareScheduledAlerts(alerts: unknown[], skipped: string[], ownerLabel: string): PreparedAlert[] {
  const prepared = new Map<string, PreparedAlert>();
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

    const alert: PreparedAlert = {
      source,
      externalId,
      mediaType,
      title,
      subtitle: typeof a.subtitle === 'string' && a.subtitle ? a.subtitle.slice(0, 500) : null,
      posterUrl: typeof a.posterUrl === 'string' && a.posterUrl ? validateImportedPosterUrl(a.posterUrl) : null,
      // hrefs are in-app paths; reject anything that could leave the app.
      href: typeof a.href === 'string' && a.href.startsWith('/') && !a.href.startsWith('//') ? a.href.slice(0, 500) : null,
      scheduleMode,
      scope,
      releaseTypes,
      offsetMinutes,
      timeZone,
      metadata,
      instanceId: typeof a.instanceId === 'string' && a.instanceId ? a.instanceId : null,
      absoluteNotifyAt,
    };
    if (!prepared.has(alertKey(alert))) prepared.set(alertKey(alert), alert);
  }
  return [...prepared.values()];
}

/**
 * Restore scheduled-alert rules for one user. Occurrences are NOT imported:
 * an absolute alert's single occurrence is recreated here from absoluteNotifyAt
 * (prepare skipped it when that time had already passed — the alert would never
 * fire), and release_relative alerts are pushed to `createdReleaseRelative` so
 * the caller resolves their occurrences after the transaction commits —
 * resolution hits external APIs and must not run inside the transaction.
 */
export async function applyPreparedScheduledAlerts(
  tx: Prisma.TransactionClient,
  alerts: PreparedAlert[],
  ownerUserId: string,
  createdReleaseRelative: ScheduledAlert[],
): Promise<number> {
  if (alerts.length === 0) return 0;

  // Instance ids are install-local; keep only those that still exist.
  const instanceIds = [...new Set(alerts.map((a) => a.instanceId).filter((id): id is string => id !== null))];
  const liveInstances = new Set(instanceIds.length === 0 ? [] : (await tx.serviceConnection.findMany({
    where: { id: { in: instanceIds } },
    select: { id: true },
  })).map((row) => row.id));

  // Idempotent re-import: an equivalent active rule already covers this target.
  const covered = new Set<string>();
  const externalIds = [...new Set(alerts.map((a) => a.externalId))];
  for (let i = 0; i < externalIds.length; i += BATCH) {
    const rows = await tx.scheduledAlert.findMany({
      where: { userId: ownerUserId, status: 'active', externalId: { in: externalIds.slice(i, i + BATCH) } },
      select: { source: true, externalId: true, mediaType: true, scope: true, scheduleMode: true },
    });
    for (const row of rows) covered.add(alertKey(row));
  }
  const toCreate = alerts.filter((a) => !covered.has(alertKey(a)));

  const created: ScheduledAlert[] = [];
  for (let i = 0; i < toCreate.length; i += BATCH) {
    created.push(...await tx.scheduledAlert.createManyAndReturn({
      data: toCreate.slice(i, i + BATCH).map((a) => ({
        userId: ownerUserId,
        source: a.source,
        externalId: a.externalId,
        mediaType: a.mediaType,
        instanceId: a.instanceId && liveInstances.has(a.instanceId) ? a.instanceId : null,
        title: a.title,
        subtitle: a.subtitle,
        posterUrl: a.posterUrl,
        href: a.href,
        scheduleMode: a.scheduleMode,
        scope: a.scope,
        releaseTypes: a.releaseTypes as unknown as Prisma.InputJsonValue,
        offsetMinutes: a.offsetMinutes,
        timeZone: a.timeZone,
        metadata: a.metadata as unknown as Prisma.InputJsonValue,
      })),
    }));
  }

  // Mirrors POST /api/scheduled-alerts' absolute-occurrence shape.
  const preparedByKey = new Map(toCreate.map((a) => [alertKey(a), a]));
  const occurrences: Prisma.ScheduledAlertOccurrenceCreateManyInput[] = [];
  for (const row of created) {
    const a = preparedByKey.get(alertKey(row))!;
    if (a.scheduleMode === 'absolute' && a.absoluteNotifyAt) {
      occurrences.push({
        alertId: row.id,
        releaseAt: a.absoluteNotifyAt,
        notifyAt: a.absoluteNotifyAt,
        releaseKind: 'custom',
        targetKey: `custom:${a.source}:${a.externalId}`,
        title: a.title,
        body: a.subtitle ?? a.title,
      });
    } else if (a.scheduleMode === 'release_relative') {
      createdReleaseRelative.push(row);
    }
  }
  for (let i = 0; i < occurrences.length; i += BATCH) {
    await tx.scheduledAlertOccurrence.createMany({ data: occurrences.slice(i, i + BATCH) });
  }
  return created.length;
}

export type { PreparedAlert };
