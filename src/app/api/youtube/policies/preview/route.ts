import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { layerMap, sanitizeLayer } from '@/lib/archive/policy';
import { prisma } from '@/lib/db';
import { YOUTUBE } from '@/lib/youtube/platform';
import { decideForYoutubeVideo, POLICY_VIDEO } from '@/lib/youtube/policy';

const PREVIEW_VIDEOS = 50;

/** Runs an unsaved draft against a channel's latest videos. Changes nothing. */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.manage');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { channelId?: unknown; policy?: unknown; typePolicies?: unknown } | null;
  if (typeof body?.channelId !== 'string') {
    return NextResponse.json({ error: 'channelId is required' }, { status: 400 });
  }
  const videos = await prisma.creatorVideo.findMany({
    where: { creatorId: body.channelId, platform: YOUTUBE },
    orderBy: { sourceCreatedAt: 'desc' },
    take: PREVIEW_VIDEOS,
    select: POLICY_VIDEO,
  });
  const draft = { channel: sanitizeLayer(body.policy), channelTypes: layerMap(body.typePolicies) };
  const results = await Promise.all(videos.map(async (video) => {
    const decision = await decideForYoutubeVideo(video, draft);
    return { id: video.id, title: video.title, type: video.type, autoDownload: decision.policy.autoDownload, reason: decision.autoDownloadReason };
  }));
  return NextResponse.json({ results });
}

export const POST = withApiLogging(postHandler, 'api/youtube/policies/preview');
