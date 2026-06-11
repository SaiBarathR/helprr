import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { parseInt32, parsePageParams } from '@/lib/pagination';

async function getHandler(request: NextRequest) {
  const err = await requireAuth();
  if (err) return err;
  const capError = await requireCapability('cleanup.view');
  if (capError) return capError;

  // Widget passes ?limit=N for a compact top-N preview; the dashboard table passes
  // ?page&pageSize. Either way we return { records, total, page, pageSize } so the
  // strike count stays accurate even when only a slice is fetched. Only cleanupStrike
  // is paginated — stall/slow rules are bounded config used for the maxStrikes map.
  const sp = request.nextUrl.searchParams;
  const limit = parseInt32(sp.get('limit'), { min: 1, max: 100 });
  const { skip, take, page, pageSize } =
    limit != null
      ? { skip: 0, take: limit, page: 1, pageSize: limit }
      : parsePageParams(sp, { defaultSize: 30, maxSize: 100 });

  const [strikes, total, stallRules, slowRules] = await Promise.all([
    prisma.cleanupStrike.findMany({ orderBy: { lastSeenAt: 'desc' }, skip, take }),
    prisma.cleanupStrike.count(),
    prisma.stallRule.findMany({ select: { id: true, name: true, maxStrikes: true } }),
    prisma.slowRule.findMany({ select: { id: true, name: true, maxStrikes: true } }),
  ]);
  const queueCfg = await prisma.queueCleanerConfig.findUnique({ where: { id: 'singleton' } });
  const failedImportMax = ((queueCfg?.failedImport as Record<string, unknown> | null)?.maxStrikes as number | undefined) ?? 0;
  const metadataMax = queueCfg?.downloadingMetadataMaxStrikes ?? 0;
  const ruleMap = new Map<string, { name: string; maxStrikes: number }>();
  for (const r of stallRules) ruleMap.set(r.id, { name: r.name, maxStrikes: r.maxStrikes });
  for (const r of slowRules) ruleMap.set(r.id, { name: r.name, maxStrikes: r.maxStrikes });

  const records = strikes.map((s) => {
    const r = s.ruleId ? ruleMap.get(s.ruleId) : null;
    const maxStrikes = r?.maxStrikes
      ?? (s.strikeType === 'failedImport' ? failedImportMax : s.strikeType === 'downloadingMetadata' ? metadataMax : 3);
    return {
      id: s.id,
      hash: s.hash,
      torrentName: s.torrentName,
      strikeType: s.strikeType,
      ruleId: s.ruleId,
      ruleName: r?.name ?? null,
      count: s.count,
      maxStrikes,
      lastSeenAt: s.lastSeenAt,
    };
  });

  return NextResponse.json({ records, total, page, pageSize });
}

export const GET = withApiLogging(getHandler, 'api/cleanup/strikes');
