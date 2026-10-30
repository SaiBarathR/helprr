import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { helixGet, TwitchHelixError, TwitchNotConfiguredError } from '@/lib/twitch/helix';
import { DEFAULT_DOWNLOAD_OPTIONS, enqueueDownload, isClientRequestId, type DownloadOptions } from '@/lib/twitch/jobs';
import { serializeJob, JOB_SELECT } from '@/lib/twitch/serialize-job';
import { parseTwitchLogin, subscribeToStreamer } from '@/lib/twitch/streamers';
import { upsertVideoFromHelix, type HelixVideoWithUser } from '@/lib/twitch/sync';

const MAX_LISTED = 200;
const VIDEO_URL = /^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/videos\/(\d{5,20})(?:[/?#].*)?$/;

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const jobs = await prisma.twitchJob.findMany({
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    take: MAX_LISTED,
    select: JOB_SELECT,
  });
  return NextResponse.json({ jobs: jobs.map(serializeJob) });
}

function readOptions(value: unknown): DownloadOptions {
  const body = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const flag = (key: 'chat' | 'chapters' | 'reencode' | 'keepForever') =>
    typeof body[key] === 'boolean' ? body[key] : DEFAULT_DOWNLOAD_OPTIONS[key];
  return {
    quality: typeof body.quality === 'string' && /^[a-z0-9_]{1,16}$/i.test(body.quality) ? body.quality : DEFAULT_DOWNLOAD_OPTIONS.quality,
    chat: flag('chat'),
    chapters: flag('chapters'),
    reencode: flag('reencode'),
    keepForever: flag('keepForever'),
  };
}

// A pasted link may name a video Helprr has not seen; Twitch is asked, never the link itself.
async function resolvePastedVideo(url: string, userId: string): Promise<string | null> {
  const twitchVideoId = VIDEO_URL.exec(url.trim())?.[1];
  if (!twitchVideoId) return null;
  const known = await prisma.twitchVideo.findUnique({ where: { twitchVideoId }, select: { id: true } });
  if (known) return known.id;

  const { data } = await helixGet<HelixVideoWithUser>('/videos', { id: twitchVideoId });
  const video = data[0];
  const login = video && parseTwitchLogin(video.user_login);
  if (!login) return null;
  const subscribed = await subscribeToStreamer(userId, login);
  return subscribed ? upsertVideoFromHelix(video, subscribed.streamer) : null;
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.download');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  if (body.clientRequestId !== undefined && !isClientRequestId(body.clientRequestId)) {
    return NextResponse.json({ error: 'Invalid clientRequestId' }, { status: 400 });
  }

  let videoId: string | null = null;
  const pasted = typeof body.url === 'string';
  try {
    if (typeof body.videoId === 'string') {
      const video = await prisma.twitchVideo.findUnique({ where: { id: body.videoId }, select: { id: true } });
      videoId = video?.id ?? null;
    } else if (pasted) {
      videoId = await resolvePastedVideo(body.url as string, auth.user.id);
    }
  } catch (error) {
    if (error instanceof TwitchNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (!(error instanceof TwitchHelixError && error.status === 404)) {
      return NextResponse.json({ error: 'Could not reach Twitch' }, { status: 502 });
    }
  }
  if (!videoId) return NextResponse.json({ error: 'Video not found' }, { status: 404 });

  const result = await enqueueDownload({
    videoId,
    source: pasted ? 'URL' : 'MANUAL',
    options: readOptions(body.options),
    actor: { id: auth.user.id, username: auth.user.username },
    clientRequestId: body.clientRequestId as string | undefined,
  });
  return NextResponse.json(result, { status: result.created ? 201 : 200 });
}

export const GET = withApiLogging(getHandler, 'api/twitch/jobs');
export const POST = withApiLogging(postHandler, 'api/twitch/jobs');
