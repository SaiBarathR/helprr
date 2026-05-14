import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler() {
  const err = await requireAuth();
  if (err) return err;
  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const start7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [today, week, all, byCleaner] = await Promise.all([
    prisma.cleanupHistory.count({ where: { createdAt: { gte: startToday } } }),
    prisma.cleanupHistory.count({ where: { createdAt: { gte: start7d } } }),
    prisma.cleanupHistory.count(),
    prisma.cleanupHistory.groupBy({ by: ['cleaner'], _count: { _all: true } }),
  ]);

  const queueTotal = byCleaner.find((r) => r.cleaner === 'queue')?._count._all ?? 0;
  const downloadTotal = byCleaner.find((r) => r.cleaner === 'download')?._count._all ?? 0;

  const activeStrikes = await prisma.cleanupStrike.count();

  return NextResponse.json({
    removedToday: today,
    removedThisWeek: week,
    removedAllTime: all,
    queueTotal,
    downloadTotal,
    activeStrikes,
  });
}

export const GET = withApiLogging(getHandler, 'api/cleanup/stats');
