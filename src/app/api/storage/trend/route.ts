import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';
import type { DiskTrend, DiskTrendDirection, StorageTrendResponse } from '@/types/service-stats';

// Trend window. We keep 90 days of snapshots but a 7-day growth rate is what the
// widget shows; a slightly wider lookback steadies the fit when a day is missed.
const WINDOW_DAYS = 8;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// |7-day projected change| under this fraction of total reads as "flat".
const FLAT_FRACTION = 0.005;

type Point = { day: number; used: number };

// Least-squares slope of used bytes vs day; returns bytes/day (0 when undefined).
function bytesPerDay(points: Point[]): number {
  const n = points.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const p of points) {
    sumX += p.day;
    sumY += p.used;
    sumXY += p.day * p.used;
    sumXX += p.day * p.day;
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-9) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

async function getHandler() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  // Disk space is gated behind the arr view caps (mirrors /api/services/stats):
  // a user who can't see any *arr library doesn't get its storage trend either.
  const canViewDisks =
    can(user, 'movies.view') || can(user, 'series.view') || can(user, 'music.view');
  if (!canViewDisks) {
    return NextResponse.json({ trends: {} } satisfies StorageTrendResponse);
  }

  const since = new Date(Date.now() - WINDOW_DAYS * MS_PER_DAY);
  const rows = await prisma.diskUsageSnapshot.findMany({
    where: { capturedAt: { gte: since } },
    orderBy: { capturedAt: 'asc' },
    select: { diskId: true, totalSpace: true, freeSpace: true, capturedAt: true },
  });

  // Group snapshots per disk in chronological order.
  const byDisk = new Map<string, { day: number; used: number; free: number; total: number }[]>();
  for (const row of rows) {
    const total = Number(row.totalSpace);
    const free = Number(row.freeSpace);
    const list = byDisk.get(row.diskId) ?? [];
    list.push({
      day: row.capturedAt.getTime() / MS_PER_DAY,
      used: total - free,
      free,
      total,
    });
    byDisk.set(row.diskId, list);
  }

  const trends: Record<string, DiskTrend> = {};
  for (const [id, pts] of byDisk) {
    if (pts.length < 2) continue;
    const perDayBytes = bytesPerDay(pts.map((p) => ({ day: p.day, used: p.used })));
    const latest = pts[pts.length - 1];

    let direction: DiskTrendDirection = 'flat';
    const sevenDayChange = Math.abs(perDayBytes) * 7;
    if (latest.total > 0 && sevenDayChange >= latest.total * FLAT_FRACTION) {
      direction = perDayBytes > 0 ? 'up' : 'down';
    }

    const daysUntilFull =
      perDayBytes > 0 && latest.free > 0 ? latest.free / perDayBytes : null;

    trends[id] = { diskId: id, direction, perDayBytes, daysUntilFull };
  }

  return NextResponse.json({ trends } satisfies StorageTrendResponse);
}

export const GET = withApiLogging(getHandler, 'api/storage/trend');
