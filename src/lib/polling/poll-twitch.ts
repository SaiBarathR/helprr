// Twitch has no "new VOD" event, so live status and videos are polled. Throttles
// live in the database: an in-memory one would reset, and re-spend, on restart.
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import { getJellyfinClient } from '@/lib/service-helpers';
import { helixGet, type HelixRateLimit } from '@/lib/twitch/helix';
import { reconcileTwitchJobs } from '@/lib/twitch/reconcile';
import { inReencodeWindow } from '@/lib/twitch/reencode-window';
import { enqueueDownload } from '@/lib/twitch/jobs';
import { decideForVideo } from '@/lib/twitch/policy-store';
import { checkStoredBrowserToken } from '@/lib/twitch/browser-token';
import { getTwitchSettings } from '@/lib/twitch/settings';
import { syncStreamerVideos } from '@/lib/twitch/sync';
import { errorMessage, notifyAndLog } from './shared';

const STREAMS_BATCH = 100;
const MAX_VIDEO_CHECKS_PER_CYCLE = 40;
const MIN_RATE_LIMIT_REMAINING = 50;
const OFFLINE_AFTER_MISSES = 2;
const AFTER_STREAM_CHECK_MS = 2 * 60_000;
const EXPIRY_WARNING_MS = 48 * 3_600_000;
const EXPIRY_NOTIFY_HOUR = 10;
const URGENT_PRIORITY = 100;
const JELLYFIN_BUSY_MS = 90_000;

interface HelixStream {
  id: string;
  user_id: string;
  title: string;
  game_name: string;
}

function rateLimited(rateLimit: HelixRateLimit): boolean {
  return rateLimit.remaining !== null && rateLimit.remaining < MIN_RATE_LIMIT_REMAINING;
}

export async function pollTwitch(now = new Date()): Promise<void> {
  const connection = await prisma.serviceConnection.findFirst({ where: { type: 'TWITCH' }, select: { id: true } });
  if (!connection) return;
  // Nobody following a streamer means nothing to tell anyone, so no API budget goes on them.
  const followed = { subscriptions: { some: {} } };
  const streamers = await prisma.twitchStreamer.findMany({ where: followed, orderBy: { id: 'asc' } });

  const settings = await getTwitchSettings();
  try {
    // Each on its own: Jellyfin being down must not stop Twitch discovery.
    await isolated('reconcile', () => reconcileTwitchJobs(now));
    await isolated('Jellyfin busy check', () => markJellyfinBusy(settings, now));
    await isolated('browser token check', () => checkStoredBrowserToken(settings, now));
    await isolated('urgent jobs', () => raiseUrgentJobs(now));

    // Finished jobs above still need their pushes with nobody followed; Twitch itself does not.
    if (streamers.length === 0) return;

    const liveDue = !settings.lastLivePollAt
      || now.getTime() - settings.lastLivePollAt.getTime() >= settings.pollLiveSecs * 1000;
    if (liveDue) {
      const limited = await pollLive(streamers, now);
      await prisma.twitchSettings.update({ where: { id: 'singleton' }, data: { lastLivePollAt: now } });
      if (limited) return;
    }

    const due = await prisma.twitchStreamer.findMany({
      where: { ...followed, OR: [{ nextVideosCheckAt: null }, { nextVideosCheckAt: { lte: now } }] },
      orderBy: { nextVideosCheckAt: { sort: 'asc', nulls: 'first' } },
      take: MAX_VIDEO_CHECKS_PER_CYCLE,
    });
    for (const streamer of due) {
      // Advanced first, so one failing streamer cannot hold up the rest every cycle.
      await prisma.twitchStreamer.update({
        where: { id: streamer.id },
        data: { nextVideosCheckAt: new Date(now.getTime() + settings.pollVideosSecs * 1000) },
      });
      try {
        const { rateLimit, newVideoIds } = await syncStreamerVideos(streamer, now);
        await notifyNewVideos(streamer.id, newVideoIds, now);
        await autoEnqueue(newVideoIds);
        if (rateLimited(rateLimit)) return;
      } catch (error) {
        noteJobFailure(error);
        logger.warn('Twitch video sweep failed', { streamerId: streamer.id, error: errorMessage(error) }, { scope: 'polling' });
      }
    }

    if (now.getHours() >= EXPIRY_NOTIFY_HOUR && liveDue) await notifyExpiring(now);
  } catch (error) {
    noteJobFailure(error);
    logger.warn('Twitch poll failed', { error: errorMessage(error) }, { scope: 'polling' });
  }
}

async function isolated(step: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    noteJobFailure(error);
    logger.warn(`Twitch ${step} failed`, { error: errorMessage(error) }, { scope: 'polling' });
  }
}

async function pollLive(
  streamers: Array<{ id: string; twitchUserId: string; isLive: boolean; liveMissedChecks: number }>,
  now: Date,
): Promise<boolean> {
  const live = new Map<string, HelixStream>();
  let limited = false;
  for (let start = 0; start < streamers.length; start += STREAMS_BATCH) {
    const ids = streamers.slice(start, start + STREAMS_BATCH).map((streamer) => streamer.twitchUserId);
    const page = await helixGet<HelixStream>('/streams', { user_id: ids, first: STREAMS_BATCH });
    for (const stream of page.data) live.set(stream.user_id, stream);
    if (rateLimited(page.rateLimit)) {
      limited = true;
      break;
    }
  }

  for (const streamer of streamers) {
    const stream = live.get(streamer.twitchUserId);
    if (stream) {
      await prisma.twitchStreamer.update({
        where: { id: streamer.id },
        data: {
          isLive: true,
          liveStreamId: stream.id,
          liveTitle: stream.title,
          liveCategory: stream.game_name || null,
          liveMissedChecks: 0,
          lastLiveAt: now,
        },
      });
    } else if (streamer.isLive && !limited) {
      const misses = streamer.liveMissedChecks + 1;
      // The archive publishes shortly after a stream ends; the regular sweep covers the rest.
      await prisma.twitchStreamer.update({
        where: { id: streamer.id },
        data: misses >= OFFLINE_AFTER_MISSES
          ? { isLive: false, liveStreamId: null, liveMissedChecks: 0, nextVideosCheckAt: new Date(now.getTime() + AFTER_STREAM_CHECK_MS) }
          : { liveMissedChecks: misses },
      });
    }
  }
  return limited;
}

// The worker has no Jellyfin access, so it is told. It starts no encode while this is in the future.
async function markJellyfinBusy(
  settings: { reencodeEnabled: boolean; reencodeWindowStart: string; reencodeWindowEnd: string },
  now: Date,
): Promise<void> {
  if (!settings.reencodeEnabled || !inReencodeWindow(now, settings.reencodeWindowStart, settings.reencodeWindowEnd)) return;
  const pending = await prisma.twitchJob.count({ where: { kind: 'REENCODE', state: { in: ['QUEUED', 'RETRY_WAIT'] } } });
  if (pending === 0) return;
  const client = await getJellyfinClient();
  const sessions = await client.getActiveSessions();
  if (sessions.some((session) => session.TranscodingInfo && session.TranscodingInfo.IsVideoDirect === false)) {
    await prisma.twitchSettings.update({
      where: { id: 'singleton' },
      data: { jellyfinBusyUntil: new Date(now.getTime() + JELLYFIN_BUSY_MS) },
    });
  }
}

async function autoEnqueue(videoIds: string[]): Promise<void> {
  if (videoIds.length === 0) return;
  const videos = await prisma.twitchVideo.findMany({
    where: { id: { in: videoIds } },
    select: { id: true, title: true, type: true, category: true, streamerId: true, durationSeconds: true },
  });
  for (const video of videos) {
    const { policy, trace, autoDownloadReason } = await decideForVideo(video);
    if (!policy.autoDownload) continue;
    const { quality, chat, chapters, reencode, keepForever } = policy;
    await enqueueDownload({
      videoId: video.id,
      source: 'RULE',
      options: { quality, chat, chapters, reencode, keepForever },
      trace: { ...trace, reason: autoDownloadReason },
    });
  }
}

// Moves what is already queued up the queue. It never queues anything itself.
async function raiseUrgentJobs(now: Date): Promise<void> {
  await prisma.twitchJob.updateMany({
    where: {
      kind: 'DOWNLOAD',
      state: { in: ['QUEUED', 'RETRY_WAIT'] },
      priority: { lt: URGENT_PRIORITY },
      video: { estimatedExpiresAt: { gt: now, lte: new Date(now.getTime() + EXPIRY_WARNING_MS) } },
    },
    data: { priority: URGENT_PRIORITY },
  });
}

const TYPE_LABELS = { ARCHIVE: 'past broadcast', HIGHLIGHT: 'highlight', UPLOAD: 'upload', CLIP: 'clip' } as const;

async function notifyNewVideos(streamerId: string, videoIds: string[], now: Date): Promise<void> {
  if (videoIds.length === 0) return;
  const [videos, subscriptions] = await Promise.all([
    prisma.twitchVideo.findMany({
      where: { id: { in: videoIds } },
      select: {
        id: true, twitchVideoId: true, title: true, type: true, category: true, streamerId: true, durationSeconds: true,
        streamer: { select: { displayName: true } },
      },
    }),
    prisma.twitchSubscription.findMany({ where: { streamerId, notifyNewVods: true }, select: { userId: true } }),
  ]);
  for (const video of videos) {
    if (!(await decideForVideo(video)).policy.notify) continue;
    for (const { userId } of subscriptions) {
      await notifyAndLog({
        eventType: 'twitchVodNew',
        title: `${video.streamer.displayName}: new ${TYPE_LABELS[video.type]}`,
        body: video.title.slice(0, 200),
        url: `/twitch/vod/${video.id}`,
        dedupeKey: `twitch-vod-${video.twitchVideoId}-${userId}`,
        userIds: [userId],
        ownerUserId: userId,
        metadata: { source: 'twitch', id: video.id, redirect: `/twitch/vod/${video.id}?download=1` },
      }, { service: 'twitch', instanceId: streamerId, reason: 'new-vod' });
    }
  }
  await prisma.twitchVideo.updateMany({ where: { id: { in: videoIds } }, data: { notifiedAt: now } });
}

async function notifyExpiring(now: Date): Promise<void> {
  const videos = await prisma.twitchVideo.findMany({
    where: {
      type: 'ARCHIVE',
      availability: 'PUBLISHED',
      expiryNotifiedAt: null,
      estimatedExpiresAt: { gt: now, lte: new Date(now.getTime() + EXPIRY_WARNING_MS) },
      mediaFiles: { none: {} },
    },
    select: {
      id: true,
      twitchVideoId: true,
      title: true,
      streamerId: true,
      userStates: { where: { hidden: true }, select: { userId: true } },
      streamer: {
        select: {
          displayName: true,
          subscriptions: { where: { notifyNewVods: true }, select: { userId: true } },
        },
      },
    },
  });
  for (const video of videos) {
    const hiddenBy = new Set(video.userStates.map((state) => state.userId));
    for (const { userId } of video.streamer.subscriptions) {
      if (hiddenBy.has(userId)) continue;
      await notifyAndLog({
        eventType: 'twitchVodExpiring',
        title: `${video.streamer.displayName}: VOD expiring soon`,
        body: video.title.slice(0, 200),
        url: `/twitch/vod/${video.id}`,
        dedupeKey: `twitch-vod-expiring-${video.twitchVideoId}-${userId}`,
        userIds: [userId],
        ownerUserId: userId,
        metadata: { source: 'twitch', id: video.id, redirect: `/twitch/vod/${video.id}?download=1` },
      }, { service: 'twitch', instanceId: video.streamerId, reason: 'vod-expiring' });
    }
    await prisma.twitchVideo.update({ where: { id: video.id }, data: { expiryNotifiedAt: now } });
  }
}
