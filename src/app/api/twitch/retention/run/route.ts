import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { enqueueFileDelete, findRetentionCandidates, verifyRetentionPreview } from '@/lib/twitch/retention';

/** Deletes only what was shown in the preview and is still a candidate now. */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { fileIds?: unknown; previewToken?: unknown } | null;
  if (!Array.isArray(body?.fileIds) || body.fileIds.length === 0 || !body.fileIds.every((id) => typeof id === 'string')) {
    return NextResponse.json({ error: 'fileIds from a preview are required' }, { status: 400 });
  }
  if (!verifyRetentionPreview(body.previewToken, auth.user.id, body.fileIds as string[])) {
    return NextResponse.json({ error: 'This preview has expired. Preview again.' }, { status: 409 });
  }
  const confirmed = new Set(body.fileIds as string[]);
  const candidates = (await findRetentionCandidates(auth.user)).filter((candidate) => confirmed.has(candidate.fileId));

  for (const candidate of candidates) await enqueueFileDelete(candidate.fileId, auth.user, { retention: true });
  return NextResponse.json({ queued: candidates.length, skipped: confirmed.size - candidates.length });
}

export const POST = withApiLogging(postHandler, 'api/twitch/retention/run');
