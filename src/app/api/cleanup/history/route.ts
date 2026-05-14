import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

function parseArrayParam(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

// Accept either a full ISO timestamp (with offset) or a bare YYYY-MM-DD.
// Bare dates are interpreted as UTC midnight; if you want timezone-correct
// day boundaries the client should send the full ISO string from the user's
// local timezone.
function parseDateBoundary(raw: string | null, side: 'start' | 'end'): Date | undefined {
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const base = new Date(`${raw}T00:00:00.000Z`);
    if (side === 'end') base.setUTCDate(base.getUTCDate() + 1);
    return base;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function buildWhere(searchParams: URLSearchParams): Prisma.CleanupHistoryWhereInput {
  const cleaner = parseArrayParam(searchParams.get('cleaner'));
  const strikeType = parseArrayParam(searchParams.get('strikeType'));
  const ruleId = parseArrayParam(searchParams.get('ruleId'));
  const action = parseArrayParam(searchParams.get('action'));
  const dateFrom = parseDateBoundary(searchParams.get('dateFrom'), 'start');
  const dateTo = parseDateBoundary(searchParams.get('dateTo'), 'end');
  const where: Prisma.CleanupHistoryWhereInput = {};
  if (cleaner.length > 0) where.cleaner = { in: cleaner };
  if (strikeType.length > 0) where.strikeType = { in: strikeType };
  if (ruleId.length > 0) where.ruleId = { in: ruleId };
  if (action.length > 0) where.action = { in: action };
  if (dateFrom || dateTo) {
    const created: { gte?: Date; lt?: Date } = {};
    if (dateFrom) created.gte = dateFrom;
    if (dateTo) created.lt = dateTo;
    where.createdAt = created;
  }
  return where;
}

function serialize<T extends { torrentSize: bigint | null }>(r: T) {
  return { ...r, torrentSize: r.torrentSize != null ? Number(r.torrentSize) : null };
}

async function getHandler(req: NextRequest) {
  const err = await requireAuth();
  if (err) return err;
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get('page') ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize') ?? 30)));
  const where = buildWhere(sp);

  const [rows, total] = await Promise.all([
    prisma.cleanupHistory.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.cleanupHistory.count({ where }),
  ]);

  return NextResponse.json({
    page,
    pageSize,
    total,
    records: rows.map(serialize),
  });
}

async function deleteHandler(req: NextRequest) {
  const err = await requireAuth();
  if (err) return err;
  const sp = req.nextUrl.searchParams;
  const all = sp.get('all') === 'true';
  if (all) {
    const r = await prisma.cleanupHistory.deleteMany({});
    return NextResponse.json({ deleted: r.count });
  }
  const where = buildWhere(sp);
  const r = await prisma.cleanupHistory.deleteMany({ where });
  return NextResponse.json({ deleted: r.count });
}

export const GET = withApiLogging(getHandler, 'api/cleanup/history');
export const DELETE = withApiLogging(deleteHandler, 'api/cleanup/history');
