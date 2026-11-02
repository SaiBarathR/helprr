import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { feedGroups } from '@/lib/archive/feed-groups';
import { serializeVideoRow } from '@/lib/archive/serialize-video';
import { YOUTUBE } from '@/lib/youtube/platform';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;
  return NextResponse.json(await feedGroups(YOUTUBE, auth.user.id, request.nextUrl.searchParams, serializeVideoRow));
}

export const GET = withApiLogging(getHandler, 'api/youtube/feed/groups');
