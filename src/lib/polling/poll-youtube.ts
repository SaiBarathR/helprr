// YouTube's push feed is unreliable from here, so channels are polled, one unit each.
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import { quotaState, YoutubeKeyRejectedError, YoutubeQuotaError } from '@/lib/youtube/api';
import { enqueueDownload } from '@/lib/archive/jobs';
import { YOUTUBE } from '@/lib/youtube/platform';
import { decideForYoutubeVideo, optionsFromPolicy, POLICY_VIDEO, settleTime } from '@/lib/youtube/policy';
import { reconcileYoutubeJobs } from '@/lib/youtube/reconcile';
import { sweepWatchedVideos } from '@/lib/youtube/cleanup';
import { syncPlaylist } from '@/lib/youtube/playlists';
import { getYoutubeSettings } from '@/lib/youtube/settings';
import { syncChannelVideos } from '@/lib/youtube/sync';
import { errorMessage, notifyAndLog } from './shared';

const MAX_CHANNELS_PER_CYCLE = 40;
const SLOW_DOWN_FACTOR = 2;
const TYPE_LABELS = { SHORT: 'Short', ARCHIVE: 'live replay', HIGHLIGHT: 'video', UPLOAD: 'video', CLIP: 'video' } as const;

export async function pollYoutube(now = new Date()): Promise<void> {
  const connection = await prisma.serviceConnection.findFirst({ where: { type: 'YOUTUBE' }, select: { id: true } });
  if (!connection) return;

  // Before the quota check: finished jobs need their alerts, and this spends no units.
  await reconcileYoutubeJobs(now).catch((error) => {
    noteJobFailure(error);
    logger.warn('YouTube reconcile failed', { error: errorMessage(error) }, { scope: 'polling' });
  });

  await sweepWatchedVideos(now).catch((error) => {
    noteJobFailure(error);
    logger.warn('YouTube cleanup failed', { error: errorMessage(error) }, { scope: 'polling' });
  });

  try {
    const quota = await quotaState(now);
    if (quota.stopped) return;
    const { pollVideosSecs } = await getYoutubeSettings();
    const everyMs = pollVideosSecs * 1000 * (quota.slowDown ? SLOW_DOWN_FACTOR : 1);

    // Only channels someone follows: a playlist's other channels are stored, not polled.
    const due = await prisma.creator.findMany({
      where: {
        platform: YOUTUBE,
        subscriptions: { some: {} },
        OR: [{ nextVideosCheckAt: null }, { nextVideosCheckAt: { lte: now } }],
      },
      orderBy: { nextVideosCheckAt: { sort: 'asc', nulls: 'first' } },
      take: MAX_CHANNELS_PER_CYCLE,
    });
    for (const channel of due) {
      // Advanced first, so one failing channel cannot hold up the rest every cycle.
      await prisma.creator.update({ where: { id: channel.id }, data: { nextVideosCheckAt: new Date(now.getTime() + everyMs) } });
      try {
        const { newVideoIds } = await syncChannelVideos(channel, now);
        await notifyNewVideos(channel.id, newVideoIds, now);
        await autoEnqueue(newVideoIds, now);
      } catch (error) {
        // Neither gets better on the next channel, and each try would cost another call.
        if (error instanceof YoutubeQuotaError || error instanceof YoutubeKeyRejectedError) throw error;
        noteJobFailure(error);
        logger.warn('YouTube channel sweep failed', { channelId: channel.id, error: errorMessage(error) }, { scope: 'polling' });
      }
    }

    const lists = await prisma.creatorPlaylist.findMany({
      where: {
        platform: YOUTUBE,
        subscriptions: { some: {} },
        OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }],
      },
      orderBy: { nextCheckAt: { sort: 'asc', nulls: 'first' } },
      take: MAX_CHANNELS_PER_CYCLE,
    });
    for (const list of lists) {
      await prisma.creatorPlaylist.update({ where: { id: list.id }, data: { nextCheckAt: new Date(now.getTime() + everyMs) } });
      try {
        const { newVideoIds } = await syncPlaylist(list, now);
        await notifyListVideos(list.id, list.title, newVideoIds);
        await autoEnqueue(newVideoIds, now, list.id);
      } catch (error) {
        if (error instanceof YoutubeQuotaError || error instanceof YoutubeKeyRejectedError) throw error;
        noteJobFailure(error);
        logger.warn('YouTube playlist sweep failed', { playlistId: list.id, error: errorMessage(error) }, { scope: 'polling' });
      }
    }
  } catch (error) {
    noteJobFailure(error);
    logger.warn('YouTube poll failed', { error: errorMessage(error) }, { scope: 'polling' });
  }
}

// The same key as a channel alert, so someone following both hears once.
// Only what a sweep just found, so a deleted video never comes back by itself.
async function autoEnqueue(videoIds: string[], now: Date, playlistId?: string): Promise<void> {
  if (videoIds.length === 0) return;
  const videos = await prisma.creatorVideo.findMany({ where: { id: { in: videoIds } }, select: POLICY_VIDEO });
  for (const video of videos) {
    const { policy, trace, autoDownloadReason } = await decideForYoutubeVideo(video, { playlistId });
    if (!policy.autoDownload) continue;
    await enqueueDownload({
      platform: YOUTUBE,
      videoId: video.id,
      source: 'RULE',
      options: optionsFromPolicy(policy),
      trace: { ...trace, reason: autoDownloadReason },
      runAfter: settleTime(video, policy, now),
    });
  }
}

async function notifyListVideos(playlistId: string, listTitle: string, videoIds: string[]): Promise<void> {
  if (videoIds.length === 0) return;
  const [videos, subscriptions] = await Promise.all([
    prisma.creatorVideo.findMany({ where: { id: { in: videoIds } }, select: { id: true, externalId: true, title: true } }),
    prisma.creatorPlaylistSubscription.findMany({ where: { playlistId, notifyNewVideos: true }, select: { userId: true } }),
  ]);
  for (const video of videos) {
    for (const { userId } of subscriptions) {
      await notifyAndLog({
        eventType: 'youtubeVideoNew',
        title: `${listTitle}: new video`,
        body: video.title.slice(0, 200),
        url: `/youtube/video/${video.id}`,
        dedupeKey: `youtube-video-${video.externalId}-${userId}`,
        userIds: [userId],
        ownerUserId: userId,
        metadata: { source: 'youtube', id: video.id, redirect: `/youtube/video/${video.id}?download=1` },
      }, { service: 'youtube', instanceId: playlistId, reason: 'new-video' });
    }
  }
}

async function notifyNewVideos(channelId: string, videoIds: string[], now: Date): Promise<void> {
  if (videoIds.length === 0) return;
  const [videos, subscriptions] = await Promise.all([
    prisma.creatorVideo.findMany({
      where: { id: { in: videoIds } },
      select: { ...POLICY_VIDEO, externalId: true, creator: { select: { displayName: true } } },
    }),
    prisma.creatorSubscription.findMany({ where: { creatorId: channelId, notifyNewVods: true }, select: { userId: true } }),
  ]);
  for (const video of videos) {
    if (!(await decideForYoutubeVideo(video)).policy.notify) continue;
    for (const { userId } of subscriptions) {
      await notifyAndLog({
        eventType: 'youtubeVideoNew',
        title: `${video.creator.displayName}: new ${TYPE_LABELS[video.type]}`,
        body: video.title.slice(0, 200),
        url: `/youtube/video/${video.id}`,
        dedupeKey: `youtube-video-${video.externalId}-${userId}`,
        userIds: [userId],
        ownerUserId: userId,
        metadata: { source: 'youtube', id: video.id, redirect: `/youtube/video/${video.id}?download=1` },
      }, { service: 'youtube', instanceId: channelId, reason: 'new-video' });
    }
  }
  await prisma.creatorVideo.updateMany({ where: { id: { in: videoIds } }, data: { notifiedAt: now } });
}
