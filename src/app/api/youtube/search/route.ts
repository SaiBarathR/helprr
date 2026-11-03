import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { searchChannels } from '@/lib/youtube/api';
import { youtubeErrorResponse } from '@/lib/youtube/route-errors';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;

  const q = request.nextUrl.searchParams.get('q')?.trim().slice(0, 100);
  if (!q) return NextResponse.json({ results: [] });

  try {
    const channels = await searchChannels(q);
    return NextResponse.json({
      results: channels.map(({ id, title, handle, avatarUrl }) => ({ channelId: id, title, handle, avatarUrl })),
    });
  } catch (error) {
    return youtubeErrorResponse(error);
  }
}

export const GET = withApiLogging(getHandler, 'api/youtube/search');
