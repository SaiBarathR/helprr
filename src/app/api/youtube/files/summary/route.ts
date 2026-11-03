import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { summarizeFiles } from '@/lib/archive/files';
import { YOUTUBE } from '@/lib/youtube/platform';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;
  return NextResponse.json(await summarizeFiles(YOUTUBE));
}

export const GET = withApiLogging(getHandler, 'api/youtube/files/summary');
