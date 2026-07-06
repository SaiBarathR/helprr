import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { endOfDay } from 'date-fns';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { isKnownEventType } from '@/lib/notification-events';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

function buildWhere(searchParams: URLSearchParams): Prisma.NotificationHistoryWhereInput {
  const where: Prisma.NotificationHistoryWhereInput = {};

  const read = searchParams.get('read');
  const unreadOnly = searchParams.get('unreadOnly') === 'true';
  if (read === 'true') where.read = true;
  else if (read === 'false') where.read = false;
  else if (unreadOnly) where.read = false;

  const q = searchParams.get('q')?.trim();
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { body: { contains: q, mode: 'insensitive' } },
    ];
  }

  const eventTypeParam = searchParams.get('eventType');
  if (eventTypeParam) {
    const types = eventTypeParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && isKnownEventType(s));
    if (types.length > 0) where.eventType = { in: types };
  }

  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  if (dateFrom || dateTo) {
    const range: Prisma.DateTimeFilter = {};
    if (dateFrom) {
      const from = new Date(dateFrom);
      if (!Number.isNaN(from.getTime())) range.gte = from;
    }
    if (dateTo) {
      const to = new Date(dateTo);
      if (!Number.isNaN(to.getTime())) range.lte = endOfDay(to);
    }
    if (range.gte || range.lte) where.createdAt = range;
  }

  return where;
}

async function getHandler(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = request.nextUrl;
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');

    const where = buildWhere(searchParams);
    // Members see only their own owned events; admins see everything (incl. the
    // null-owner instance/global events).
    if (auth.user.role !== 'admin') where.userId = auth.user.id;

    const [records, totalRecords] = await Promise.all([
      prisma.notificationHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.notificationHistory.count({ where }),
    ]);

    return NextResponse.json({ page, pageSize, totalRecords, records });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed');
  }
}

async function deleteHandler(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = request.nextUrl;
    const where = buildWhere(searchParams);
    const all = searchParams.get('all') === 'true';
    // Members can only ever clear their own history.
    const scoped = auth.user.role !== 'admin';
    if (scoped) where.userId = auth.user.id;

    if (Object.keys(where).length === 0 && !all && !scoped) {
      return NextResponse.json(
        { error: 'Refusing unfiltered delete; pass ?all=true to confirm' },
        { status: 400 },
      );
    }

    const { count } = await prisma.notificationHistory.deleteMany({ where });
    return NextResponse.json({ deletedCount: count });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed');
  }
}

export const GET = withApiLogging(getHandler, 'api/notifications');
export const DELETE = withApiLogging(deleteHandler, 'api/notifications');
