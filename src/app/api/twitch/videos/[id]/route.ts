import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { decideForVideo } from '@/lib/archive/policy-store';
import { VIDEO_SELECT } from '@/lib/archive/serialize-video';
import { serializeVideo } from '@/lib/twitch/serialize';
import { getTwitchSettings } from '@/lib/twitch/settings';
import { TWITCH } from '@/lib/twitch/platform';

async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const video = await prisma.creatorVideo.findUnique({
    where: { id, platform: TWITCH },
    select: {
      ...VIDEO_SELECT,
      userStates: { where: { userId: auth.user.id }, select: { seenAt: true, hidden: true } },
    },
  });
  if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 });

  const { userStates, ...rest } = video;
  const [decision, settings] = await Promise.all([
    decideForVideo({ ...rest, creatorId: rest.creator.id }),
    getTwitchSettings(),
  ]);
  return NextResponse.json({
    ...serializeVideo(rest, userStates[0]?.seenAt),
    hidden: userStates[0]?.hidden ?? false,
    autoDownload: { enabled: decision.policy.autoDownload, reason: decision.autoDownloadReason, trace: decision.trace },
    // 1440p shows as login-required, so it is only offered with a working token.
    canUse1440p: Boolean(settings.browserAuthToken) && settings.browserAuthTokenValid !== false,
    defaults: {
      quality: decision.policy.quality,
      chat: decision.policy.chat,
      chapters: decision.policy.chapters,
      reencode: decision.policy.reencode,
      keepForever: decision.policy.keepForever,
    },
  });
}

export const GET = withApiLogging(getHandler, 'api/twitch/videos/[id]');
