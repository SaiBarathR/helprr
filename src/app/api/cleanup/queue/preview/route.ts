import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { runQueueCleanerCycle } from '@/lib/cleanup/queue-cleaner';
import { runQueueCleanerExclusive } from '@/lib/cleanup/scheduler';
import { issueCleanupPreview } from '@/lib/cleanup/preview-store';

async function postHandler() {
  const auth = await requireUserCapability('cleanup.manage');
  if (!auth.ok) return auth.response;

  try {
    const response = await runQueueCleanerExclusive(async () => {
      const result = await runQueueCleanerCycle({ dryRun: true, triggeredBy: 'dryRun' });
      const issued = await issueCleanupPreview(auth.user.id, result.binding);
      return {
        ...issued,
        triggeredBy: result.triggeredBy,
        dryRun: true,
        durationMs: result.durationMs,
        skippedFailedImport: result.skippedFailedImport,
        pendingStrikes: result.pendingStrikes,
        decisions: result.decisions.map((decision) => ({
          hash: decision.torrent.hash,
          torrentName: decision.torrent.name,
          strikeType: decision.strikeType,
          ruleId: decision.ruleId,
          ruleName: decision.ruleName,
          reason: decision.reason,
          private: Boolean(decision.torrent.private),
          progress: decision.torrent.progress,
          ratio: decision.torrent.ratio,
          linkedArrSource: decision.linked?.source ?? null,
          linkedArrTitle: decision.linked?.title ?? null,
          options: decision.options,
        })),
      };
    });
    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      { error: 'Cleanup preview is temporarily unavailable' },
      { status: 503 },
    );
  }
}

export const POST = withApiLogging(postHandler, 'api/cleanup/queue/preview');
