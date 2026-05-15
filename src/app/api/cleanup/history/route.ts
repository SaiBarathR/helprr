import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

const VALID_CLEANER = new Set(['queue', 'download']);
const VALID_STRIKE_TYPE = new Set(['stall', 'slow', 'failedImport', 'downloadingMetadata']);
const VALID_ACTION = new Set([
  'strikeAdded',
  'removedFromClient',
  'removedFromQueue',
  'categoryChanged',
  'dryRunPreview',
  'failed',
]);

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

type WhereResult =
  | { ok: true; where: Prisma.CleanupHistoryWhereInput }
  | { ok: false; error: string };

function buildWhere(searchParams: URLSearchParams): WhereResult {
  const cleaner = parseArrayParam(searchParams.get('cleaner'));
  const strikeType = parseArrayParam(searchParams.get('strikeType'));
  const ruleId = parseArrayParam(searchParams.get('ruleId'));
  const action = parseArrayParam(searchParams.get('action'));
  const dateFrom = parseDateBoundary(searchParams.get('dateFrom'), 'start');
  const dateTo = parseDateBoundary(searchParams.get('dateTo'), 'end');

  const bad = (field: string, value: string) => `invalid ${field}: ${value}`;
  for (const v of cleaner) if (!VALID_CLEANER.has(v)) return { ok: false, error: bad('cleaner', v) };
  for (const v of strikeType) if (!VALID_STRIKE_TYPE.has(v)) return { ok: false, error: bad('strikeType', v) };
  for (const v of action) if (!VALID_ACTION.has(v)) return { ok: false, error: bad('action', v) };

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
  return { ok: true, where };
}

function serialize<T extends { torrentSize: bigint | null }>(r: T) {
  return { ...r, torrentSize: r.torrentSize != null ? Number(r.torrentSize) : null };
}

async function getHandler(req: NextRequest) {
  const err = await requireAuth();
  if (err) return err;
  const sp = req.nextUrl.searchParams;
  const rawPage = Number(sp.get('page'));
  const rawSize = Number(sp.get('pageSize'));
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize = Number.isFinite(rawSize) && rawSize >= 1 ? Math.min(100, Math.floor(rawSize)) : 30;
  const whereResult = buildWhere(sp);
  if (!whereResult.ok) {
    return NextResponse.json({ error: whereResult.error }, { status: 400 });
  }
  const where = whereResult.where;

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
  const whereResult = buildWhere(sp);
  if (!whereResult.ok) {
    return NextResponse.json({ error: whereResult.error }, { status: 400 });
  }
  if (Object.keys(whereResult.where).length === 0) {
    return NextResponse.json({ error: 'refusing to delete all without ?all=true' }, { status: 400 });
  }
  const r = await prisma.cleanupHistory.deleteMany({ where: whereResult.where });
  return NextResponse.json({ deleted: r.count });
}

export const GET = withApiLogging(getHandler, 'api/cleanup/history');
export const DELETE = withApiLogging(deleteHandler, 'api/cleanup/history');
