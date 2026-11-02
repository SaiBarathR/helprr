import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { fileGroups } from '@/lib/archive/file-groups';
import { TWITCH } from '@/lib/twitch/platform';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;
  return NextResponse.json(await fileGroups(TWITCH, auth.user, request.nextUrl.searchParams));
}

export const GET = withApiLogging(getHandler, 'api/twitch/files/groups');
