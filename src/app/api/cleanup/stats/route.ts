import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

// Only completed removal actions count toward "Removed" tiles. Excludes
// strikeAdded (just a strike event), dryRunPreview (no action taken), and
// failed (attempted but didn't succeed).
const REMOVED_ACTIONS = ['removedFromClient', 'removedFromQueue', 'categoryChanged'];

async function getHandler() {
  const err = await requireAuth();
  if (err) return err;
  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const start7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [today, week, all, byCleaner] = await Promise.all([
    prisma.cleanupHistory.count({ where: { action: { in: REMOVED_ACTIONS }, createdAt: { gte: startToday } } }),
    prisma.cleanupHistory.count({ where: { action: { in: REMOVED_ACTIONS }, createdAt: { gte: start7d } } }),
    prisma.cleanupHistory.count({ where: { action: { in: REMOVED_ACTIONS } } }),
    prisma.cleanupHistory.groupBy({
      by: ['cleaner'],
      where: { action: { in: REMOVED_ACTIONS } },
      _count: { _all: true },
    }),
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
