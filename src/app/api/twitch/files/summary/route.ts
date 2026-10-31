import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { summarizeFiles } from '@/lib/twitch/files';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;
  return NextResponse.json(await summarizeFiles());
}

export const GET = withApiLogging(getHandler, 'api/twitch/files/summary');
