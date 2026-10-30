import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { sanitizeLayer } from '@/lib/twitch/policy';
import { decideForVideo } from '@/lib/twitch/policy-store';

const PREVIEW_VIDEOS = 50;

/** Runs an unsaved draft against a streamer's latest videos. Changes nothing. */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { streamerId?: unknown; policy?: unknown } | null;
  if (typeof body?.streamerId !== 'string') {
    return NextResponse.json({ error: 'streamerId is required' }, { status: 400 });
  }
  const videos = await prisma.twitchVideo.findMany({
    where: { streamerId: body.streamerId },
    orderBy: { twitchCreatedAt: 'desc' },
    take: PREVIEW_VIDEOS,
    select: { id: true, title: true, type: true, streamerId: true, durationSeconds: true },
  });
  const draft = { streamer: sanitizeLayer(body.policy) };
  const results = await Promise.all(videos.map(async (video) => {
    const decision = await decideForVideo(video, draft);
    return { id: video.id, title: video.title, type: video.type, autoDownload: decision.policy.autoDownload, reason: decision.autoDownloadReason, trace: decision.trace };
  }));
  return NextResponse.json({ results });
}

export const POST = withApiLogging(postHandler, 'api/twitch/policies/preview');
