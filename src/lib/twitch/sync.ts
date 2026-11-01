import type { Prisma, Creator, CreatorVideoAvailability, CreatorVideoType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { estimateExpiry } from '@/lib/twitch/expiry';
import { helixGet, parseHelixDuration, TwitchHelixError, type HelixRateLimit } from '@/lib/twitch/helix';

export interface HelixVideo {
  id: string;
  stream_id: string | null;
  title: string;
  description: string;
  created_at: string;
  published_at: string;
  thumbnail_url: string;
  view_count: number;
  language: string;
  type: string;
  duration: string;
  muted_segments: Array<{ duration: number; offset: number }> | null;
}

export interface HelixVideoWithUser extends HelixVideo {
  user_login: string;
}

const VIDEO_TYPES: Record<string, CreatorVideoType> = {
  archive: 'ARCHIVE',
  highlight: 'HIGHLIGHT',
  upload: 'UPLOAD',
};
const MISSED_SWEEPS_BEFORE_CHECK = 2;
const VIDEOS_PAGE_SIZE = 100;

type StreamerForSync = Pick<Creator, 'id' | 'externalId' | 'broadcasterType' | 'isLive' | 'liveStreamId' | 'liveCategory' | 'baselinedAt'>;

function toRow(video: HelixVideo, streamer: StreamerForSync) {
  const type = VIDEO_TYPES[video.type];
  if (!type) return null;
  const sourceCreatedAt = new Date(video.created_at);
  const availability: CreatorVideoAvailability =
    type === 'ARCHIVE' && streamer.isLive && video.stream_id !== null && video.stream_id === streamer.liveStreamId
      ? 'RECORDING'
      : 'PUBLISHED';
  return {
    externalId: video.id,
    creatorId: streamer.id,
    type,
    title: video.title,
    description: video.description || null,
    sourceCreatedAt,
    publishedAt: new Date(video.published_at),
    durationSeconds: parseHelixDuration(video.duration),
    thumbnailUrl: video.thumbnail_url || null,
    // Only a stream seen live has one; undefined leaves what is stored alone.
    category: availability === 'RECORDING' ? streamer.liveCategory ?? undefined : undefined,
    viewCount: video.view_count,
    language: video.language || null,
    streamId: video.stream_id,
    mutedSegments: (video.muted_segments ?? undefined) as Prisma.InputJsonValue | undefined,
    availability,
    estimatedExpiresAt: estimateExpiry(type, sourceCreatedAt, streamer.broadcasterType),
  };
}

/** One video by hand, such as a pasted link. Clips are refused here: they are not in the schedule of this feature. */
export async function upsertVideoFromHelix(video: HelixVideo, streamer: StreamerForSync): Promise<string | null> {
  const row = toRow(video, streamer);
  if (!row) return null;
  const { id } = await prisma.creatorVideo.upsert({
    where: { externalId: row.externalId },
    update: row,
    create: { ...row, notifiedAt: new Date() },
    select: { id: true },
  });
  return id;
}

/**
 * One sweep of a streamer's videos. The first sweep is the baseline: what is
 * already there is recorded as notified so subscribing never floods the phone.
 * An archive still recording stays unnotified and becomes new when it publishes.
 * Returns the videos that are newly publishable, for the caller to notify on.
 */
export async function syncStreamerVideos(
  streamer: StreamerForSync,
  now = new Date(),
): Promise<{ rateLimit: HelixRateLimit; newVideoIds: string[] }> {
  const page = await helixGet<HelixVideo>('/videos', {
    user_id: streamer.externalId,
    type: 'all',
    sort: 'time',
    first: VIDEOS_PAGE_SIZE,
  });
  const rows = page.data.flatMap((video) => toRow(video, streamer) ?? []);
  const isBaseline = streamer.baselinedAt === null;

  const existing = await prisma.creatorVideo.findMany({
    where: { creatorId: streamer.id },
    select: {
      id: true, externalId: true, title: true, durationSeconds: true, viewCount: true,
      availability: true, notifiedAt: true, thumbnailUrl: true, sourceCreatedAt: true, missingSweeps: true,
    },
  });
  const byTwitchId = new Map(existing.map((video) => [video.externalId, video]));

  const created = rows.filter((row) => !byTwitchId.has(row.externalId));
  if (created.length > 0) {
    await prisma.creatorVideo.createMany({
      data: created.map((row) => ({
        ...row,
        firstSeenAt: now,
        lastSeenAt: now,
        notifiedAt: isBaseline && row.availability === 'PUBLISHED' ? now : null,
      })),
      skipDuplicates: true,
    });
  }

  // Only changed rows are written, so a sweep of an idle streamer costs one bulk update.
  const seenIds: string[] = [];
  for (const row of rows) {
    const current = byTwitchId.get(row.externalId);
    if (!current) continue;
    seenIds.push(current.id);
    if (
      current.title !== row.title
      || current.durationSeconds !== row.durationSeconds
      || current.viewCount !== row.viewCount
      || current.availability !== row.availability
      || current.thumbnailUrl !== row.thumbnailUrl
    ) {
      await prisma.creatorVideo.update({ where: { id: current.id }, data: row });
    }
  }
  if (seenIds.length > 0) {
    await prisma.creatorVideo.updateMany({
      where: { id: { in: seenIds } },
      data: { lastSeenAt: now, missingSweeps: 0 },
    });
  }

  await markMissingVideos(existing, rows, now);

  if (isBaseline) {
    await prisma.creator.update({ where: { id: streamer.id }, data: { baselinedAt: now } });
  }

  const pending = await prisma.creatorVideo.findMany({
    where: {
      creatorId: streamer.id,
      notifiedAt: null,
      availability: 'PUBLISHED',
      type: { not: 'CLIP' },
    },
    select: { id: true },
  });
  return { rateLimit: page.rateLimit, newVideoIds: pending.map((video) => video.id) };
}

// A video older than the page cannot be judged: it is simply out of view.
async function markMissingVideos(
  existing: Array<{ id: string; externalId: string; availability: CreatorVideoAvailability; sourceCreatedAt: Date; missingSweeps: number }>,
  rows: Array<{ externalId: string; sourceCreatedAt: Date }>,
  now: Date,
): Promise<void> {
  const inPage = new Set(rows.map((row) => row.externalId));
  // An empty page proves nothing by itself: each video is still looked up by id before it is marked.
  const oldest = rows.length > 0 ? Math.min(...rows.map((row) => row.sourceCreatedAt.getTime())) : 0;
  const missing = existing.filter((video) =>
    !inPage.has(video.externalId)
    && video.availability !== 'UNAVAILABLE'
    && (rows.length < VIDEOS_PAGE_SIZE || video.sourceCreatedAt.getTime() >= oldest));

  for (const video of missing) {
    const missingSweeps = video.missingSweeps + 1;
    if (missingSweeps < MISSED_SWEEPS_BEFORE_CHECK) {
      await prisma.creatorVideo.update({ where: { id: video.id }, data: { missingSweeps } });
      continue;
    }
    const gone = await isVideoGone(video.externalId);
    await prisma.creatorVideo.update({
      where: { id: video.id },
      data: gone
        ? { missingSweeps, availability: 'UNAVAILABLE' }
        : { missingSweeps: 0, lastSeenAt: now },
    });
  }
}

// Helix answers 404 rather than an empty list when no requested id exists.
async function isVideoGone(twitchVideoId: string): Promise<boolean> {
  try {
    const page = await helixGet<HelixVideo>('/videos', { id: twitchVideoId });
    return page.data.length === 0;
  } catch (error) {
    if (error instanceof TwitchHelixError && error.status === 404) return true;
    throw error;
  }
}
