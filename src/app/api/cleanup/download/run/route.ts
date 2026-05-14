import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { runDownloadCleanerCycle } from '@/lib/cleanup/download-cleaner';
import { awaitInFlightDownload } from '@/lib/cleanup/scheduler';

function serializeResult(r: Awaited<ReturnType<typeof runDownloadCleanerCycle>>) {
  return {
    triggeredBy: r.triggeredBy,
    dryRun: r.dryRun,
    durationMs: r.durationMs,
    decisions: r.decisions.map((d) => ({
      hash: d.torrent.hash,
      torrentName: d.torrent.name,
      ruleId: d.rule.id,
      ruleName: d.rule.name,
      reason: d.reason,
      seedingHours: d.seedingHours,
      ratio: d.torrent.ratio,
      progress: d.torrent.progress,
      private: Boolean(d.torrent.private),
      deleteSourceFiles: d.rule.deleteSourceFiles,
    })),
  };
}

async function postHandler(req: NextRequest) {
  const err = await requireAuth();
  if (err) return err;
  let body: { dryRun?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }
  const dryRun = Boolean((body as { dryRun?: unknown }).dryRun);

  await awaitInFlightDownload();
  const result = await runDownloadCleanerCycle({ dryRun, triggeredBy: dryRun ? 'dryRun' : 'manual' });
  return NextResponse.json(serializeResult(result));
}

export const POST = withApiLogging(postHandler, 'api/cleanup/download/run');
