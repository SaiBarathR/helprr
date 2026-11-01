import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { DEFAULT_YOUTUBE_OPTIONS, enqueueDownload, isClientRequestId, type DownloadOptions } from '@/lib/archive/jobs';
import { serializeJob, JOB_SELECT } from '@/lib/archive/serialize-job';
import { CODECS, QUALITIES, SPONSORBLOCK_MODES } from '@/lib/youtube/formats';
import { parseVideoLink } from '@/lib/youtube/ids';
import { YOUTUBE } from '@/lib/youtube/platform';
import { storeVideoById } from '@/lib/youtube/playlists';
import { youtubeErrorResponse } from '@/lib/youtube/route-errors';

const MAX_LISTED = 200;
const DONE_LISTED = 20;
const WORKER_STALE_MS = 5 * 60_000;

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;

  // Apart, so a long queue cannot push the finished ones off the page.
  const [open, finished] = await Promise.all([
    prisma.archiveJob.findMany({
      where: { platform: YOUTUBE, kind: { not: 'FORMATS' }, state: { notIn: ['DONE', 'CANCELLED'] } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: MAX_LISTED,
      select: JOB_SELECT,
    }),
    prisma.archiveJob.findMany({
      where: { platform: YOUTUBE, state: 'DONE', kind: 'DOWNLOAD' },
      orderBy: { finishedAt: 'desc' },
      take: DONE_LISTED,
      select: JOB_SELECT,
    }),
  ]);
  return NextResponse.json({ jobs: [...open, ...finished].map(serializeJob) });
}

const oneOf = <T extends string>(allowed: readonly T[], value: unknown, fallback: T | string): T | string => (
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value : fallback
);

// Only fixed choices reach the worker, which builds its yt-dlp arguments from them.
function readOptions(value: unknown): DownloadOptions {
  const body = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const defaults = DEFAULT_YOUTUBE_OPTIONS;
  return {
    ...defaults,
    quality: oneOf(QUALITIES, body.quality, defaults.quality),
    codec: oneOf(CODECS, body.codec, defaults.codec!),
    sponsorblock: oneOf(SPONSORBLOCK_MODES, body.sponsorblock, defaults.sponsorblock!),
    keepForever: typeof body.keepForever === 'boolean' ? body.keepForever : defaults.keepForever,
    chapters: typeof body.chapters === 'boolean' ? body.chapters : defaults.chapters,
  };
}

/** Why nothing could run this now, in words a person can act on. */
async function whyNotReady(): Promise<string | null> {
  const heartbeat = await prisma.archiveWorkerHeartbeat.findFirst({
    orderBy: { lastSeenAt: 'desc' },
    select: { platforms: true, lastSeenAt: true },
  });
  // Long enough to ride out a restart, so an update does not refuse a download.
  if (!heartbeat || Date.now() - heartbeat.lastSeenAt.getTime() > WORKER_STALE_MS) return 'The worker is offline. Start it, then try again.';
  const ready = Array.isArray(heartbeat.platforms) && heartbeat.platforms.includes('YOUTUBE');
  return ready ? null : 'The worker has no YouTube folder yet. Finish setup in Settings → YouTube.';
}

// A pasted link may name a video Helprr has not seen. Only its id is ever used.
async function resolvePastedVideo(url: string): Promise<string | null> {
  const externalId = parseVideoLink(url);
  if (!externalId) return null;
  const known = await prisma.creatorVideo.findUnique({
    where: { platform_externalId: { platform: YOUTUBE, externalId } },
    select: { id: true },
  });
  return known?.id ?? storeVideoById(externalId);
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.download');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  if (body.clientRequestId !== undefined && !isClientRequestId(body.clientRequestId)) {
    return NextResponse.json({ error: 'Invalid clientRequestId' }, { status: 400 });
  }
  // Queued now, it could wait forever with nothing to tell the person why.
  const notReady = await whyNotReady();
  if (notReady) return NextResponse.json({ error: notReady }, { status: 409 });

  let videoId: string | null = null;
  const pasted = typeof body.url === 'string';
  try {
    if (typeof body.videoId === 'string') {
      const video = await prisma.creatorVideo.findUnique({ where: { id: body.videoId, platform: YOUTUBE }, select: { id: true } });
      videoId = video?.id ?? null;
    } else if (pasted) {
      videoId = await resolvePastedVideo(body.url as string);
    }
  } catch (error) {
    return youtubeErrorResponse(error);
  }
  if (!videoId) return NextResponse.json({ error: 'Video not found' }, { status: 404 });

  const result = await enqueueDownload({
    platform: YOUTUBE,
    videoId,
    source: pasted ? 'URL' : 'MANUAL',
    options: readOptions(body.options),
    trace: { reason: 'manual' },
    actor: { id: auth.user.id, username: auth.user.username },
    clientRequestId: body.clientRequestId as string | undefined,
  });
  return NextResponse.json(result, { status: result.created ? 201 : 200 });
}

export const GET = withApiLogging(getHandler, 'api/youtube/jobs');
export const POST = withApiLogging(postHandler, 'api/youtube/jobs');
