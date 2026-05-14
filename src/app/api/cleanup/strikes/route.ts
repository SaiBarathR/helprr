import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler() {
  const err = await requireAuth();
  if (err) return err;
  const [strikes, stallRules, slowRules] = await Promise.all([
    prisma.cleanupStrike.findMany({ orderBy: { lastSeenAt: 'desc' } }),
    prisma.stallRule.findMany({ select: { id: true, name: true, maxStrikes: true } }),
    prisma.slowRule.findMany({ select: { id: true, name: true, maxStrikes: true } }),
  ]);
  const queueCfg = await prisma.queueCleanerConfig.findUnique({ where: { id: 'singleton' } });
  const failedImportMax = ((queueCfg?.failedImport as Record<string, unknown> | null)?.maxStrikes as number | undefined) ?? 0;
  const metadataMax = queueCfg?.downloadingMetadataMaxStrikes ?? 0;
  const ruleMap = new Map<string, { name: string; maxStrikes: number }>();
  for (const r of stallRules) ruleMap.set(r.id, { name: r.name, maxStrikes: r.maxStrikes });
  for (const r of slowRules) ruleMap.set(r.id, { name: r.name, maxStrikes: r.maxStrikes });

  return NextResponse.json(
    strikes.map((s) => {
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
    }),
  );
}

export const GET = withApiLogging(getHandler, 'api/cleanup/strikes');
