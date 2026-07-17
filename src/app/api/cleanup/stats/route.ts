import { NextRequest, NextResponse } from 'next/server';
import { CleanupAction, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

// Only completed removal actions count toward "Removed" tiles. Excludes
// strikeAdded (just a strike event), dryRunPreview (no action taken), and
// failed (attempted but didn't succeed). `skipped` is also excluded since
// nothing was actually removed.
const REMOVED_ACTIONS: CleanupAction[] = [
  CleanupAction.removedFromClient,
  CleanupAction.removedFromQueue,
  CleanupAction.categoryChanged,
];

// A removal row with outcomeStatus 'partial'/'failed'/'stale' did not fully
// complete — it must not inflate the "Removed" tiles. Legacy rows (null
// outcomeStatus) predate outcome tracking and were only written on success.
const REMOVED_WHERE: Prisma.CleanupHistoryWhereInput = {
  action: { in: REMOVED_ACTIONS },
  OR: [{ outcomeStatus: null }, { outcomeStatus: 'succeeded' }],
};

// "Today" is a user-local concept; the client passes its UTC offset in
// minutes (Date.prototype.getTimezoneOffset semantics: minutes BEHIND UTC).
// Missing/invalid values fall back to the server's local midnight.
function startOfToday(tzOffsetRaw: string | null): Date {
  const offset = Number(tzOffsetRaw);
  if (tzOffsetRaw === null || !Number.isFinite(offset) || Math.abs(offset) > 840) {
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    return startToday;
  }
  const local = new Date(Date.now() - offset * 60_000);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() + offset * 60_000);
}

async function getHandler(req: NextRequest) {
  const err = await requireAuth();
  if (err) return err;
  const capError = await requireCapability('cleanup.view');
  if (capError) return capError;
  const now = new Date();
  const startToday = startOfToday(req.nextUrl.searchParams.get('tzOffsetMinutes'));
  const start7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [today, week, all, byCleaner, totalStrikes, reSearchedAllTime, activeStrikes] = await Promise.all([
    prisma.cleanupHistory.count({ where: { ...REMOVED_WHERE, createdAt: { gte: startToday } } }),
    prisma.cleanupHistory.count({ where: { ...REMOVED_WHERE, createdAt: { gte: start7d } } }),
    prisma.cleanupHistory.count({ where: REMOVED_WHERE }),
    prisma.cleanupHistory.groupBy({
      by: ['cleaner'],
      where: REMOVED_WHERE,
      _count: { _all: true },
    }),
    prisma.cleanupHistory.count({ where: { action: 'strikeAdded' } }),
    prisma.cleanupHistory.count({ where: { reSearched: true } }),
    prisma.cleanupStrike.count(),
  ]);

  const queueTotal = byCleaner.find((r) => r.cleaner === 'queue')?._count._all ?? 0;
  const downloadTotal = byCleaner.find((r) => r.cleaner === 'download')?._count._all ?? 0;

  return NextResponse.json({
    removedToday: today,
    removedThisWeek: week,
    removedAllTime: all,
    queueTotal,
    downloadTotal,
    activeStrikes,
    totalStrikes,
    reSearchedAllTime,
  });
}

export const GET = withApiLogging(getHandler, 'api/cleanup/stats');
