import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { parseReleaseTypes, isAlertScope, isScheduleMode } from '@/lib/scheduled-alerts/helpers';
import { resolveAlertOccurrences } from '@/lib/scheduled-alerts/resolver';
import { upsertOccurrencesForAlert } from '@/lib/scheduled-alerts/delivery';
import { serializeAlert } from '@/lib/scheduled-alerts/serialize';
import type { ScheduledAlertMetadata } from '@/lib/scheduled-alerts/types';

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

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data: Prisma.ScheduledAlertUpdateInput = {};
  if (typeof body.title === 'string' && body.title.trim()) data.title = body.title.trim().slice(0, 200);
  if (typeof body.scheduleMode === 'string' && isScheduleMode(body.scheduleMode)) {
    data.scheduleMode = body.scheduleMode;
  }
  if (typeof body.scope === 'string' && isAlertScope(body.scope)) data.scope = body.scope;
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
  if (body.seasonNumber !== undefined || body.episodeId !== undefined) {
    data.metadata = metadata as Prisma.InputJsonValue;
  }

  const alert = await prisma.scheduledAlert.update({ where: { id }, data });
  const modeChanged = existing.scheduleMode !== alert.scheduleMode;

  if (typeof body.absoluteNotifyAt === 'string' && alert.scheduleMode === 'absolute') {
    const notifyAt = new Date(body.absoluteNotifyAt);
    if (!Number.isFinite(notifyAt.getTime())) {
      return NextResponse.json({ error: 'Invalid absoluteNotifyAt' }, { status: 400 });
    }
    await prisma.scheduledAlertOccurrence.deleteMany({
      where: { alertId: id, status: 'pending' },
    });
    await prisma.scheduledAlertOccurrence.create({
      data: {
        alertId: id,
        releaseAt: notifyAt,
        notifyAt,
        releaseKind: 'custom',
        targetKey: `custom:${alert.source}:${alert.externalId}`,
        title: alert.title,
        body: alert.subtitle ?? alert.title,
      },
    });
  } else if (alert.scheduleMode === 'release_relative') {
    if (modeChanged) {
      await prisma.scheduledAlertOccurrence.deleteMany({
        where: { alertId: id, status: 'pending' },
      });
    }
    const candidates = await resolveAlertOccurrences(alert);
    await upsertOccurrencesForAlert(alert, candidates);
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
