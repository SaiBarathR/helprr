import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { findRetentionCandidates } from '@/lib/twitch/retention';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;
  return NextResponse.json({ candidates: await findRetentionCandidates(auth.user) });
}

export const GET = withApiLogging(getHandler, 'api/twitch/retention/preview');
