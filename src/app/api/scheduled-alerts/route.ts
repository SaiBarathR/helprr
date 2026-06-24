import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import {
  getDefaultTimeZone,
  parseCreateInput,
  resolveHref,
} from '@/lib/scheduled-alerts/helpers';
import { resolveAlertOccurrences } from '@/lib/scheduled-alerts/resolver';
import { upsertOccurrencesForAlert } from '@/lib/scheduled-alerts/delivery';
import { serializeAlert } from '@/lib/scheduled-alerts/serialize';
import type { ScheduledAlertMetadata } from '@/lib/scheduled-alerts/types';

function buildListWhere(userId: string, params: URLSearchParams): Prisma.ScheduledAlertWhereInput {
  const where: Prisma.ScheduledAlertWhereInput = { userId };
  const q = params.get('q')?.trim();
  if (q) where.title = { contains: q, mode: 'insensitive' };

  const status = params.get('status');
  if (status === 'active' || status === 'cancelled') {
    where.status = status;
  } else if (status === 'upcoming') {
    where.status = 'active';
    where.occurrences = { some: { status: 'pending', notifyAt: { gte: new Date() } } };
  } else if (status === 'sent' || status === 'failed') {
    where.occurrences = { some: { status } };
  }

  const mediaType = params.get('mediaType');
  if (mediaType) where.mediaType = mediaType;

  const source = params.get('source');
  if (source) where.source = source.toUpperCase();

  const scheduleMode = params.get('scheduleMode');
  if (scheduleMode === 'absolute' || scheduleMode === 'release_relative') {
    where.scheduleMode = scheduleMode;
  }

  const occurrenceStatus = params.get('occurrenceStatus');
  const dateFrom = params.get('dateFrom');
  const dateTo = params.get('dateTo');
  const releaseKind = params.get('releaseKind');

  if (occurrenceStatus || dateFrom || dateTo || releaseKind) {
    const occWhere: Prisma.ScheduledAlertOccurrenceWhereInput = {};
    if (occurrenceStatus) occWhere.status = occurrenceStatus;
    if (releaseKind) occWhere.releaseKind = releaseKind;
    if (dateFrom || dateTo) {
      const range: Prisma.DateTimeFilter = {};
      if (dateFrom) {
        const from = new Date(dateFrom);
        if (Number.isFinite(from.getTime())) range.gte = from;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        if (Number.isFinite(to.getTime())) range.lte = to;
      }
      if (range.gte || range.lte) occWhere.notifyAt = range;
    }
    where.occurrences = where.occurrences
      ? { some: { AND: [(where.occurrences as { some: Prisma.ScheduledAlertOccurrenceWhereInput }).some, occWhere] } }
      : { some: occWhere };
  }

  return where;
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('scheduledAlerts.view');
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(params.get('pageSize') ?? '30', 10) || 30));
  const sort = params.get('sort') ?? 'nextNotify';
  const includeOccurrences = params.get('includeOccurrences') === 'true';

  const where = buildListWhere(auth.user.id, params);

  const alerts = await prisma.scheduledAlert.findMany({
    where,
    include: {
      occurrences: includeOccurrences
        ? { orderBy: { notifyAt: 'asc' } }
        : {
            where: { status: 'pending', notifyAt: { gte: new Date() } },
            orderBy: { notifyAt: 'asc' },
            take: 5,
          },
    },
    orderBy: sort === 'title' ? { title: 'asc' } : sort === 'created' ? { createdAt: 'desc' } : { updatedAt: 'desc' },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  let records = alerts.map((a) => serializeAlert(a, a.occurrences));
  if (sort === 'nextNotify') {
    records = records.sort((a, b) => {
      const ta = a.nextOccurrence ? new Date(a.nextOccurrence.notifyAt).getTime() : Infinity;
      const tb = b.nextOccurrence ? new Date(b.nextOccurrence.notifyAt).getTime() : Infinity;
      return ta - tb;
    });
  }

  const totalRecords = await prisma.scheduledAlert.count({ where });
  return NextResponse.json({ page, pageSize, totalRecords, records });
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('scheduledAlerts.edit');
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const settings = await getOrCreateAppSettings();
  const userSettings = await prisma.userSettings.findUnique({ where: { userId: auth.user.id } });
  const fallbackTz = getDefaultTimeZone(userSettings?.timeZone ?? settings.timeZone);
  const parsed = parseCreateInput(body, fallbackTz);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { draft, scheduleMode, scope, releaseTypes, offsetMinutes, timeZone, absoluteNotifyAt } = parsed;
  const metadata: ScheduledAlertMetadata = {};
  if (draft.seasonNumber != null) metadata.seasonNumber = draft.seasonNumber;
  if (draft.episodeId != null) metadata.episodeId = draft.episodeId;

  const alert = await prisma.scheduledAlert.create({
    data: {
      userId: auth.user.id,
      source: draft.source,
      externalId: draft.externalId,
      mediaType: draft.mediaType,
      instanceId: draft.instanceId ?? null,
      title: draft.title,
      subtitle: draft.subtitle ?? null,
      posterUrl: draft.posterUrl ?? null,
      href: resolveHref(draft),
      scheduleMode,
      scope,
      releaseTypes,
      offsetMinutes,
      timeZone,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });

  if (scheduleMode === 'absolute' && absoluteNotifyAt) {
    const notifyAt = new Date(absoluteNotifyAt);
    await prisma.scheduledAlertOccurrence.create({
      data: {
        alertId: alert.id,
        releaseAt: notifyAt,
        notifyAt,
        releaseKind: 'custom',
        targetKey: `custom:${draft.source}:${draft.externalId}`,
        title: draft.title,
        body: draft.subtitle ?? draft.title,
      },
    });
  } else {
    const candidates = await resolveAlertOccurrences(alert);
    await upsertOccurrencesForAlert(alert, candidates);
  }

  const full = await prisma.scheduledAlert.findUnique({
    where: { id: alert.id },
    include: { occurrences: { orderBy: { notifyAt: 'asc' } } },
  });

  return NextResponse.json({ alert: full ? serializeAlert(full, full.occurrences) : serializeAlert(alert) });
}

export const GET = withApiLogging(getHandler, 'api/scheduled-alerts');
export const POST = withApiLogging(postHandler, 'api/scheduled-alerts');
