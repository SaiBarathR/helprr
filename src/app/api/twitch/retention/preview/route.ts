import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { findRetentionCandidates, signRetentionPreview } from '@/lib/archive/retention';
import { TWITCH } from '@/lib/twitch/platform';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;
  const candidates = await findRetentionCandidates(auth.user, TWITCH);
  return NextResponse.json({
    candidates,
    previewToken: signRetentionPreview(auth.user.id, candidates.map((candidate) => candidate.fileId)),
  });
}

export const GET = withApiLogging(getHandler, 'api/twitch/retention/preview');
