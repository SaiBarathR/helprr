import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { feedCategories } from '@/lib/archive/feed';
import { feedGroups } from '@/lib/archive/feed-groups';
import { serializeVideo } from '@/lib/twitch/serialize';
import { TWITCH } from '@/lib/twitch/platform';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;
  const [groups, categories] = await Promise.all([
    feedGroups(TWITCH, auth.user.id, request.nextUrl.searchParams, serializeVideo),
    feedCategories(TWITCH, auth.user.id),
  ]);
  return NextResponse.json({ ...groups, categories });
}

export const GET = withApiLogging(getHandler, 'api/twitch/feed/groups');
