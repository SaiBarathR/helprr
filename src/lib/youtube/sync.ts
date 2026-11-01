import type { Creator, CreatorVideoAvailability, CreatorVideoType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { playlistItems, shortsListOf, uploadsListOf, videosById, type YoutubeVideo } from '@/lib/youtube/api';
import { YOUTUBE } from '@/lib/youtube/platform';

const PAGE_SIZE = 50;
const SHORT_CANDIDATE_SECS = 180;
const SURELY_SHORT_SECS = 60;
const MISSED_SWEEPS_BEFORE_CHECK = 2;
// What a list says about a video it can no longer show. The real title stays on our row.
const HIDDEN_TITLES = new Set(['Private video', 'Deleted video']);

type ChannelForSync = Pick<Creator, 'id' | 'externalId' | 'baselinedAt'>;

const isLiveVideo = (video: YoutubeVideo) => video.wasLive || video.liveState !== 'none';
const mayBeShort = (video: YoutubeVideo) => !isLiveVideo(video) && video.durationSeconds <= SHORT_CANDIDATE_SECS;

function videoType(video: YoutubeVideo, shorts: Set<string> | null): CreatorVideoType {
  if (isLiveVideo(video)) return 'ARCHIVE';
  if (!mayBeShort(video)) return 'UPLOAD';
  if (shorts) return shorts.has(video.id) ? 'SHORT' : 'UPLOAD';
  return video.durationSeconds <= SURELY_SHORT_SECS ? 'SHORT' : 'UPLOAD';
}

// The Shorts list is undocumented, so null here falls back to length alone.
async function shortIds(channelId: string): Promise<Set<string> | null> {
  try {
    const page = await playlistItems(shortsListOf(channelId));
    if (page) return new Set(page.items.map((item) => item.videoId));
  } catch (error) {
    logger.warn('YouTube Shorts list failed', { channelId, error: String(error) }, { scope: 'polling' });
  }
  return null;
}

function toRow(video: YoutubeVideo, creatorId: string, shorts: Set<string> | null) {
  // A stream can only be saved once it has ended, so it waits here until then.
  const availability: CreatorVideoAvailability = video.liveState === 'none' ? 'PUBLISHED' : 'RECORDING';
  return {
    platform: YOUTUBE,
    externalId: video.id,
    creatorId,
    type: videoType(video, shorts),
    title: video.title,
    description: video.description,
    sourceCreatedAt: video.publishedAt,
    publishedAt: video.publishedAt,
    durationSeconds: video.durationSeconds,
    thumbnailUrl: video.thumbnailUrl,
    viewCount: video.viewCount,
    availability,
    liveEndedAt: video.liveEndedAt,
    ageRestricted: video.ageRestricted,
  };
}

/**
 * One sweep of a channel. One unit for its uploads list, then only what that list cannot
 * answer: new ids, and streams that had not ended. The first sweep is the baseline, recorded
 * as notified so following never floods the phone. A stream stays unnotified until it ends.
 */
export async function syncChannelVideos(channel: ChannelForSync, now = new Date()): Promise<{ newVideoIds: string[] }> {
  const page = await playlistItems(uploadsListOf(channel.externalId), PAGE_SIZE);
  const listed = (page?.items ?? []).filter((item) => !HIDDEN_TITLES.has(item.title));
  const isBaseline = channel.baselinedAt === null;

  const existing = await prisma.creatorVideo.findMany({
    where: { creatorId: channel.id },
    select: { id: true, externalId: true, title: true, availability: true, sourceCreatedAt: true, missingSweeps: true },
  });
  const known = new Map(existing.map((video) => [video.externalId, video]));

  const details = await videosById([
    ...listed.filter((item) => !known.has(item.videoId)).map((item) => item.videoId),
    ...existing.filter((video) => video.availability === 'RECORDING').map((video) => video.externalId),
  ]);
  const shorts = details.some(mayBeShort) ? await shortIds(channel.externalId) : null;
  const rows = details.map((video) => toRow(video, channel.id, shorts));

  const created = rows.filter((row) => !known.has(row.externalId));
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
  for (const row of rows) {
    const current = known.get(row.externalId);
    if (current) await prisma.creatorVideo.update({ where: { id: current.id }, data: row });
  }

  // Titles change often after upload, and the list carries them for free.
  const seenIds: string[] = [];
  for (const item of listed) {
    const current = known.get(item.videoId);
    if (!current) continue;
    seenIds.push(current.id);
    if (item.title && item.title !== current.title) {
      await prisma.creatorVideo.update({ where: { id: current.id }, data: { title: item.title } });
    }
  }
  if (seenIds.length > 0) {
    await prisma.creatorVideo.updateMany({ where: { id: { in: seenIds } }, data: { lastSeenAt: now, missingSweeps: 0 } });
  }

  await markMissingVideos(existing, new Set(listed.map((item) => item.videoId)), listed.length < PAGE_SIZE, now);
  if (isBaseline) await prisma.creator.update({ where: { id: channel.id }, data: { baselinedAt: now } });

  const pending = await prisma.creatorVideo.findMany({
    where: { creatorId: channel.id, notifiedAt: null, availability: 'PUBLISHED' },
    select: { id: true },
  });
  return { newVideoIds: pending.map((video) => video.id) };
}

// A video older than the page is simply out of view. An empty or failed list proves nothing
// by itself, so each candidate is still looked up by id. Its file is never touched.
async function markMissingVideos(
  existing: Array<{ id: string; externalId: string; availability: CreatorVideoAvailability; sourceCreatedAt: Date; missingSweeps: number }>,
  listed: Set<string>,
  wholeList: boolean,
  now: Date,
): Promise<void> {
  const inPage = existing.filter((video) => listed.has(video.externalId)).map((video) => video.sourceCreatedAt.getTime());
  // A full page of unknown videos says nothing about how far back it reaches.
  const oldest = inPage.length > 0 ? Math.min(...inPage) : Infinity;
  const missing = existing.filter((video) =>
    !listed.has(video.externalId)
    && video.availability !== 'UNAVAILABLE'
    && (wholeList || video.sourceCreatedAt.getTime() >= oldest));

  const due: typeof missing = [];
  for (const video of missing) {
    if (video.missingSweeps + 1 >= MISSED_SWEEPS_BEFORE_CHECK) due.push(video);
    else await prisma.creatorVideo.update({ where: { id: video.id }, data: { missingSweeps: video.missingSweeps + 1 } });
  }
  if (due.length === 0) return;

  const found = new Set((await videosById(due.map((video) => video.externalId))).map((video) => video.id));
  const gone = due.filter((video) => !found.has(video.externalId)).map((video) => video.id);
  const here = due.filter((video) => found.has(video.externalId)).map((video) => video.id);
  await prisma.creatorVideo.updateMany({ where: { id: { in: gone } }, data: { availability: 'UNAVAILABLE' } });
  await prisma.creatorVideo.updateMany({ where: { id: { in: here } }, data: { missingSweeps: 0, lastSeenAt: now } });
}
