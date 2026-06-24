import type { ScheduledAlert, ScheduledAlertOccurrence } from '@prisma/client';
import { RELEASE_KIND_LABELS } from '@/lib/scheduled-alerts/constants';
import { ruleSummary } from '@/lib/scheduled-alerts/helpers';
import type { ReleaseKind } from '@/lib/scheduled-alerts/types';

export interface SerializedOccurrence {
  id: string;
  alertId: string;
  releaseAt: string | null;
  notifyAt: string;
  releaseKind: string;
  releaseKindLabel: string;
  targetKey: string;
  title: string;
  body: string | null;
  status: string;
  attempts: number;
  sentAt: string | null;
  cancelledAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SerializedAlert {
  id: string;
  userId: string;
  source: string;
  externalId: string;
  mediaType: string;
  instanceId: string | null;
  title: string;
  subtitle: string | null;
  posterUrl: string | null;
  href: string | null;
  scheduleMode: string;
  scope: string;
  releaseTypes: ReleaseKind[];
  offsetMinutes: number;
  timeZone: string;
  status: string;
  ruleSummary: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  nextOccurrence: SerializedOccurrence | null;
  occurrences?: SerializedOccurrence[];
}

function serializeOccurrence(o: ScheduledAlertOccurrence): SerializedOccurrence {
  return {
    id: o.id,
    alertId: o.alertId,
    releaseAt: o.releaseAt ? o.releaseAt.toISOString() : null,
    notifyAt: o.notifyAt.toISOString(),
    releaseKind: o.releaseKind,
    releaseKindLabel: RELEASE_KIND_LABELS[o.releaseKind as ReleaseKind] ?? o.releaseKind,
    targetKey: o.targetKey,
    title: o.title,
    body: o.body,
    status: o.status,
    attempts: o.attempts,
    sentAt: o.sentAt ? o.sentAt.toISOString() : null,
    cancelledAt: o.cancelledAt ? o.cancelledAt.toISOString() : null,
    metadata: (o.metadata as Record<string, unknown>) ?? null,
  };
}

export function serializeAlert(
  alert: ScheduledAlert,
  occurrences: ScheduledAlertOccurrence[] = [],
): SerializedAlert {
  const releaseTypes = Array.isArray(alert.releaseTypes)
    ? (alert.releaseTypes as ReleaseKind[])
    : [];
  const pending = occurrences
    .filter((o) => o.status === 'pending')
    .sort((a, b) => a.notifyAt.getTime() - b.notifyAt.getTime());
  const nextOccurrence = pending[0] ? serializeOccurrence(pending[0]) : null;

  return {
    id: alert.id,
    userId: alert.userId,
    source: alert.source,
    externalId: alert.externalId,
    mediaType: alert.mediaType,
    instanceId: alert.instanceId,
    title: alert.title,
    subtitle: alert.subtitle,
    posterUrl: alert.posterUrl,
    href: alert.href,
    scheduleMode: alert.scheduleMode,
    scope: alert.scope,
    releaseTypes,
    offsetMinutes: alert.offsetMinutes,
    timeZone: alert.timeZone,
    status: alert.status,
    ruleSummary: ruleSummary({
      scheduleMode: alert.scheduleMode as never,
      scope: alert.scope as never,
      releaseTypes,
      offsetMinutes: alert.offsetMinutes,
    }),
    createdAt: alert.createdAt.toISOString(),
    updatedAt: alert.updatedAt.toISOString(),
    cancelledAt: alert.cancelledAt ? alert.cancelledAt.toISOString() : null,
    nextOccurrence,
    occurrences: occurrences.map(serializeOccurrence),
  };
}
