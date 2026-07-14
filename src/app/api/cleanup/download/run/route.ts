import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { runDownloadCleanerCycle } from '@/lib/cleanup/download-cleaner';
import { runDownloadCleanerExclusive } from '@/lib/cleanup/scheduler';
import { consumeCleanupPreview, InvalidCleanupPreviewError } from '@/lib/cleanup/preview-store';
import { StaleCleanupPreviewError } from '@/lib/cleanup/binding';

function serializeResult(r: Awaited<ReturnType<typeof runDownloadCleanerCycle>>) {
  return {
    triggeredBy: r.triggeredBy,
    dryRun: r.dryRun,
    durationMs: r.durationMs,
    succeeded: r.succeeded,
    failed: r.failed,
    outcomes: r.outcomes,
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
  const auth = await requireUserCapability('cleanup.manage');
  if (!auth.ok) return auth.response;
  let body: { previewToken?: unknown };
  try { body = (await req.json()) as { previewToken?: unknown }; }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  if (typeof body?.previewToken !== 'string' || body.previewToken.length < 32 || body.previewToken.length > 256) {
    return NextResponse.json(
      { error: 'A valid previewToken is required. Run a fresh cleanup preview first.' },
      { status: 428 },
    );
  }

  try {
    const result = await runDownloadCleanerExclusive(async () => {
      const preview = await consumeCleanupPreview(auth.user.id, 'download', body.previewToken as string);
      return runDownloadCleanerCycle({
        dryRun: false,
        triggeredBy: 'manual',
        expectedBinding: preview.binding,
        previewId: preview.previewId,
      });
    });
    return NextResponse.json(serializeResult(result));
  } catch (error) {
    if (error instanceof InvalidCleanupPreviewError) {
      return NextResponse.json({ error: error.message, code: 'PREVIEW_INVALID' }, { status: 409 });
    }
    if (error instanceof StaleCleanupPreviewError) {
      return NextResponse.json({ error: error.message, code: 'PREVIEW_STALE' }, { status: 409 });
    }
    throw error;
  }
}

// previewToken is a short-lived bearer capability; never include this request
// body in optional failed-request logging.
export const POST = withApiLogging(postHandler, 'api/cleanup/download/run', { logBodies: false });
