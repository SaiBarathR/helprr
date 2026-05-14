import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { runQueueCleanerCycle } from '@/lib/cleanup/queue-cleaner';
import { awaitInFlightQueue } from '@/lib/cleanup/scheduler';

function serializeResult(r: Awaited<ReturnType<typeof runQueueCleanerCycle>>) {
  return {
    triggeredBy: r.triggeredBy,
    dryRun: r.dryRun,
    durationMs: r.durationMs,
    skippedFailedImport: r.skippedFailedImport,
    pendingStrikes: r.pendingStrikes,
    decisions: r.decisions.map((d) => ({
      hash: d.torrent.hash,
      torrentName: d.torrent.name,
      strikeType: d.strikeType,
      ruleId: d.ruleId,
      ruleName: d.ruleName,
      reason: d.reason,
      private: Boolean(d.torrent.private),
      progress: d.torrent.progress,
      ratio: d.torrent.ratio,
      linkedArrSource: d.linked?.source ?? null,
      linkedArrTitle: d.linked?.title ?? null,
      options: d.options,
    })),
  };
}

async function postHandler(req: NextRequest) {
  const err = await requireAuth();
  if (err) return err;
  let body: { dryRun?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }
  const dryRun = Boolean((body as { dryRun?: unknown }).dryRun);

  await awaitInFlightQueue();
  const result = await runQueueCleanerCycle({ dryRun, triggeredBy: dryRun ? 'dryRun' : 'manual' });
  return NextResponse.json(serializeResult(result));
}

export const POST = withApiLogging(postHandler, 'api/cleanup/queue/run');
