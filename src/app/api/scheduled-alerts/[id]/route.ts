import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { parseReleaseTypes, isAlertScope, isScheduleMode, musicAlertForbidden, scopeFitsMediaType } from '@/lib/scheduled-alerts/helpers';
import { resolveAlertOccurrencesResult } from '@/lib/scheduled-alerts/resolver';
import { defaultReleaseTypes, releasedError } from '@/lib/scheduled-alerts/constants';
import { announceNewAlbums, upsertOccurrencesForAlert } from '@/lib/scheduled-alerts/delivery';
import { serializeAlert } from '@/lib/scheduled-alerts/serialize';
import type { AlertScope, ScheduledAlertMetadata } from '@/lib/scheduled-alerts/types';

async function ownedAlert(userId: string, id: string) {
  return prisma.scheduledAlert.findFirst({ where: { id, userId } });
}

async function patchHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('scheduledAlerts.edit');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await ownedAlert(auth.user.id, id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const forbidden = musicAlertForbidden(auth.user, existing.source);
  if (forbidden) return forbidden;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const nextScheduleMode =
    typeof body.scheduleMode === 'string' && isScheduleMode(body.scheduleMode)
      ? body.scheduleMode
      : existing.scheduleMode;

  let absoluteNotifyAt: Date | null = null;
  if (nextScheduleMode === 'absolute') {
    const raw = body.absoluteNotifyAt;
    if (typeof raw !== 'string' || !raw.trim()) {
      return NextResponse.json({ error: 'absoluteNotifyAt is required' }, { status: 400 });
    }
    absoluteNotifyAt = new Date(raw);
    if (!Number.isFinite(absoluteNotifyAt.getTime())) {
      return NextResponse.json({ error: 'Invalid absoluteNotifyAt' }, { status: 400 });
    }
    if (absoluteNotifyAt.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: 'Reminder must be in the future' }, { status: 400 });
    }
  }

  const data: Prisma.ScheduledAlertUpdateInput = {};
  if (typeof body.title === 'string' && body.title.trim()) data.title = body.title.trim().slice(0, 200);
  if (typeof body.scheduleMode === 'string' && isScheduleMode(body.scheduleMode)) {
    data.scheduleMode = body.scheduleMode;
  }
  // A music alert's scope says what its id is (album or artist), so it never changes.
  if (
    existing.mediaType !== 'music' &&
    typeof body.scope === 'string' && isAlertScope(body.scope) && scopeFitsMediaType(body.scope, existing.mediaType)
  ) {
    data.scope = body.scope;
  }
  if (body.releaseTypes !== undefined) data.releaseTypes = parseReleaseTypes(body.releaseTypes);
  if (typeof body.offsetMinutes === 'number' && Number.isFinite(body.offsetMinutes)) {
    data.offsetMinutes = Math.max(0, Math.min(10_080, Math.round(body.offsetMinutes)));
  }
  if (typeof body.timeZone === 'string' && body.timeZone.trim()) data.timeZone = body.timeZone.trim();
  if (body.status === 'active') {
    data.status = 'active';
    data.cancelledAt = null;
  }

  const metadata = { ...((existing.metadata ?? {}) as ScheduledAlertMetadata) };
  if (typeof body.seasonNumber === 'number') metadata.seasonNumber = body.seasonNumber;
  if (typeof body.episodeId === 'number') metadata.episodeId = body.episodeId;
  // A cancelled artist alert was not refreshed: start its seen albums afresh
  // rather than announce every album Lidarr learned of meanwhile at once.
  if (data.status === 'active' && existing.status !== 'active' && metadata.knownAlbumKeys) {
    delete metadata.knownAlbumKeys;
    data.metadata = metadata as Prisma.InputJsonValue;
  }
  // Season and episode mean nothing to music, whose metadata holds the seen albums.
  if (existing.mediaType !== 'music' && (body.seasonNumber !== undefined || body.episodeId !== undefined)) {
    data.metadata = metadata as Prisma.InputJsonValue;
  }

  const modeChanged = existing.scheduleMode !== nextScheduleMode;
  // A release reminder could never go off once it is newly set on an album,
  // film or episode already out, or edited so it would be: moved to releases
  // that have all passed, to another scope, season, episode or time zone, or
  // given a notice longer than the time left. Re-checked on the alert as edited.
  const nextAlert = {
    ...existing,
    scheduleMode: 'release_relative',
    releaseTypes: (data.releaseTypes ?? existing.releaseTypes) as Prisma.JsonValue,
    offsetMinutes: typeof data.offsetMinutes === 'number' ? data.offsetMinutes : existing.offsetMinutes,
    scope: typeof data.scope === 'string' ? data.scope : existing.scope,
    timeZone: typeof data.timeZone === 'string' ? data.timeZone : existing.timeZone,
    metadata: (data.metadata ?? existing.metadata) as Prisma.JsonValue,
  };
  // Release types as the resolver reads them: in any order, none meaning the scope's default.
  const releaseKinds = (alert: { releaseTypes: Prisma.JsonValue; scope: string; mediaType: string }) => {
    const kinds = parseReleaseTypes(alert.releaseTypes);
    return new Set(kinds.length ? kinds : defaultReleaseTypes(alert.scope as AlertScope, alert.mediaType));
  };
  const [nextKinds, kinds] = [releaseKinds(nextAlert), releaseKinds(existing)];
  const edited =
    nextKinds.size !== kinds.size || [...nextKinds].some((kind) => !kinds.has(kind)) ||
    (['offsetMinutes', 'scope', 'timeZone', 'metadata'] as const).some(
      (field) => JSON.stringify(nextAlert[field]) !== JSON.stringify(existing[field]),
    );
  if (nextScheduleMode === 'release_relative' && (modeChanged || edited)) {
    const { released, tooSoon } = await resolveAlertOccurrencesResult(nextAlert, undefined, { checkAired: true });
    if (released) return NextResponse.json({ error: releasedError(released, tooSoon) }, { status: 400 });
  }

  const alert = await prisma.$transaction(async (tx) => {
    const updated = await tx.scheduledAlert.update({ where: { id }, data });

    if (nextScheduleMode === 'absolute' && absoluteNotifyAt) {
      await tx.scheduledAlertOccurrence.deleteMany({
        where: { alertId: id, status: 'pending' },
      });
      await tx.scheduledAlertOccurrence.create({
        data: {
          alertId: id,
          releaseAt: absoluteNotifyAt,
          notifyAt: absoluteNotifyAt,
          releaseKind: 'custom',
          targetKey: `custom:${updated.source}:${updated.externalId}`,
          title: updated.title,
          body: updated.subtitle ?? updated.title,
        },
      });
    } else if (updated.scheduleMode === 'release_relative') {
      if (modeChanged) {
        await tx.scheduledAlertOccurrence.deleteMany({
          where: { alertId: id, status: 'pending' },
        });
      }
    }

    return updated;
  });

  if (alert.scheduleMode === 'release_relative') {
    const { candidates, resolved, upcomingAlbums } = await resolveAlertOccurrencesResult(alert);
    await upsertOccurrencesForAlert(alert, candidates, { resolved });
    if (resolved && upcomingAlbums) await announceNewAlbums(alert, upcomingAlbums);
  }

  const full = await prisma.scheduledAlert.findUnique({
    where: { id },
    include: { occurrences: { orderBy: { notifyAt: 'asc' } } },
  });
  return NextResponse.json({
    alert: full ? serializeAlert(full, full.occurrences) : serializeAlert(alert),
  });
}

async function deleteHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('scheduledAlerts.edit');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await ownedAlert(auth.user.id, id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const now = new Date();
  await prisma.$transaction([
    prisma.scheduledAlert.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: now },
    }),
    prisma.scheduledAlertOccurrence.updateMany({
      where: { alertId: id, status: 'pending' },
      data: { status: 'cancelled', cancelledAt: now },
    }),
  ]);

  return NextResponse.json({ ok: true });
}

export const PATCH = withApiLogging(patchHandler, 'api/scheduled-alerts/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/scheduled-alerts/[id]');
