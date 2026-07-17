import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { runDownloadCleanerCycle } from '@/lib/cleanup/download-cleaner';
import { runDownloadCleanerExclusive } from '@/lib/cleanup/scheduler';
import { issueCleanupPreview } from '@/lib/cleanup/preview-store';

async function postHandler() {
  const auth = await requireUserCapability('cleanup.manage');
  if (!auth.ok) return auth.response;

  try {
    const response = await runDownloadCleanerExclusive(async () => {
      const result = await runDownloadCleanerCycle({ dryRun: true, triggeredBy: 'dryRun' });
      const issued = await issueCleanupPreview(auth.user.id, result.binding);
      return {
        ...issued,
        triggeredBy: result.triggeredBy,
        dryRun: true,
        durationMs: result.durationMs,
        warnings: result.warnings,
        decisions: result.decisions.map((decision) => ({
          hash: decision.torrent.hash,
          torrentName: decision.torrent.name,
          ruleId: decision.rule.id,
          ruleName: decision.rule.name,
          reason: decision.reason,
          seedingHours: decision.seedingHours,
          ratio: decision.torrent.ratio,
          progress: decision.torrent.progress,
          private: Boolean(decision.torrent.private),
          deleteSourceFiles: decision.rule.deleteSourceFiles,
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

export const POST = withApiLogging(postHandler, 'api/cleanup/download/preview');
