import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { notifyAndLog, errorMessage } from '@/lib/polling/shared';
import { getJellyfinClient } from '@/lib/service-helpers';
import { getTwitchSettings } from '@/lib/twitch/settings';

const WORKER_OFFLINE_MS = 10 * 60_000;
const REFRESH_GIVE_UP_MS = 30 * 60_000;
const BATCH = 10;

/** The worker has no Jellyfin access and no push keys, so finished jobs are finished here. */
export async function reconcileTwitchJobs(now: Date): Promise<void> {
  await finishPublishedJobs(now);
  await notifyFailedJobs(now);
  await checkWorker(now);
  await checkToolsPaused();
}

async function checkToolsPaused(): Promise<void> {
  const { toolsPausedAt } = await getTwitchSettings();
  if (!toolsPausedAt) return;
  await notifyAndLog({
    eventType: 'twitchWorkerIssue',
    title: 'Twitch downloads are paused',
    body: 'Several downloads failed the same way, so the tools may need an update.',
    url: '/twitch/queue',
    dedupeKey: `twitch-tools-paused-${toolsPausedAt.toISOString().slice(0, 10)}`,
    metadata: { source: 'twitch', id: 'tools', redirect: '/twitch/queue' },
  }, { service: 'twitch', instanceId: 'tools', reason: 'tools-paused' });
}

async function subscribersOf(streamerId: string, requestedByUserId: string | null): Promise<string[]> {
  if (requestedByUserId) return [requestedByUserId];
  const subscriptions = await prisma.twitchSubscription.findMany({ where: { streamerId }, select: { userId: true } });
  return subscriptions.map((subscription) => subscription.userId);
}

async function finishPublishedJobs(now: Date): Promise<void> {
  const jobs = await prisma.twitchJob.findMany({
    where: { needsJellyfinRefresh: true, state: 'DONE' },
    orderBy: { finishedAt: 'asc' },
    take: BATCH,
    include: { video: { include: { streamer: true } }, mediaFile: { select: { jellyfinItemId: true } } },
  });
  if (jobs.length === 0) return;

  const settings = await getTwitchSettings();
  let client: Awaited<ReturnType<typeof getJellyfinClient>> | null = null;
  try {
    client = await getJellyfinClient();
  } catch (error) {
    logger.warn('Twitch cannot reach Jellyfin', { error: errorMessage(error) }, { scope: 'polling' });
  }

  for (const job of jobs) {
    if (job.kind === 'DELETE_FILES') {
      if (client && settings.jellyfinLibraryItemId) {
        await client.refreshItem(settings.jellyfinLibraryItemId, { recursive: true }).catch((error) => {
          logger.warn('Twitch Jellyfin refresh failed', { jobId: job.id, error: errorMessage(error) }, { scope: 'polling' });
        });
      }
      await prisma.twitchJob.update({ where: { id: job.id }, data: { needsJellyfinRefresh: false } });
      continue;
    }

    const { video } = job;
    if (!video) {
      await prisma.twitchJob.update({ where: { id: job.id }, data: { needsJellyfinRefresh: false } });
      continue;
    }
    // A swapped file keeps its name, so the item only needs to re-read it. No push: nothing new landed.
    if (job.kind === 'REENCODE') {
      const known = job.mediaFile?.jellyfinItemId;
      if (client && known) {
        await client.refreshItem(known, { recursive: false }).catch((error) => {
          logger.warn('Twitch Jellyfin refresh failed', { jobId: job.id, error: errorMessage(error) }, { scope: 'polling' });
        });
      }
      await prisma.twitchJob.update({ where: { id: job.id }, data: { needsJellyfinRefresh: false } });
      continue;
    }

    let itemId: string | null = null;
    if (client && settings.jellyfinLibraryItemId) {
      try {
        // A new streamer has no series yet: refreshing the library finds it.
        const series = await client.queryItems({
          ParentId: settings.jellyfinLibraryItemId, IncludeItemTypes: 'Series', Recursive: true, Fields: 'Path',
        });
        const seriesItem = series.Items?.find((item) => item.Path?.endsWith(`/${video.streamer.folderName}`));
        await client.refreshItem(seriesItem?.Id ?? settings.jellyfinLibraryItemId, { recursive: true });

        const found = await client.queryItems({
          ParentId: settings.jellyfinLibraryItemId,
          IncludeItemTypes: 'Episode',
          Recursive: true,
          Tags: `twitch-v${video.twitchVideoId}`,
        });
        itemId = found.Items?.[0]?.Id ?? null;
      } catch (error) {
        logger.warn('Twitch Jellyfin refresh failed', { jobId: job.id, error: errorMessage(error) }, { scope: 'polling' });
      }
    }

    const finishedAt = job.finishedAt ?? now;
    const givenUp = now.getTime() - finishedAt.getTime() > REFRESH_GIVE_UP_MS;
    if (!itemId && !givenUp) continue;

    if (itemId) {
      await prisma.twitchMediaFile.updateMany({ where: { videoId: video.id }, data: { jellyfinItemId: itemId } });
    }
    const redirect = itemId ? `/jellyfin/library/item/${itemId}` : `/twitch/vod/${video.id}`;
    for (const userId of await subscribersOf(video.streamerId, job.requestedByUserId)) {
      await notifyAndLog({
        eventType: 'twitchDownloadComplete',
        title: `${video.streamer.displayName}: download complete`,
        body: video.title.slice(0, 200),
        url: redirect,
        dedupeKey: `twitch-complete-${job.id}-${userId}`,
        userIds: [userId],
        ownerUserId: userId,
        metadata: { source: 'twitch', id: video.id, redirect },
      }, { service: 'twitch', instanceId: job.id, reason: 'download-complete' });
    }
    await prisma.twitchJob.update({ where: { id: job.id }, data: { needsJellyfinRefresh: false } });
  }
}

async function notifyFailedJobs(now: Date): Promise<void> {
  const jobs = await prisma.twitchJob.findMany({
    where: { state: 'FAILED', kind: 'DOWNLOAD', failureNotifiedAt: null },
    take: BATCH,
    include: { video: { include: { streamer: true } } },
  });
  for (const job of jobs) {
    if (job.video) {
      for (const userId of await subscribersOf(job.video.streamerId, job.requestedByUserId)) {
        await notifyAndLog({
          eventType: 'twitchDownloadFailed',
          title: `${job.video.streamer.displayName}: download failed`,
          body: job.video.title.slice(0, 200),
          url: '/twitch/queue',
          dedupeKey: `twitch-failed-${job.id}-${job.attempts}-${userId}`,
          userIds: [userId],
          ownerUserId: userId,
          metadata: { source: 'twitch', id: job.id, redirect: '/twitch/queue' },
        }, { service: 'twitch', instanceId: job.id, reason: 'download-failed' });
      }
    }
    await prisma.twitchJob.update({ where: { id: job.id }, data: { failureNotifiedAt: now } });
  }
}

async function checkWorker(now: Date): Promise<void> {
  const active = await prisma.twitchJob.count({ where: { state: { in: ['QUEUED', 'RUNNING'] } } });
  if (active === 0) return;
  const heartbeat = await prisma.twitchWorkerHeartbeat.findFirst({ orderBy: { lastSeenAt: 'desc' }, select: { lastSeenAt: true } });
  if (heartbeat && now.getTime() - heartbeat.lastSeenAt.getTime() < WORKER_OFFLINE_MS) return;

  const dayKey = now.toISOString().slice(0, 10);
  await notifyAndLog({
    eventType: 'twitchWorkerIssue',
    title: 'Twitch worker is offline',
    body: 'Downloads are waiting for the worker to come back.',
    url: '/twitch/queue',
    dedupeKey: `twitch-worker-offline-${dayKey}`,
    metadata: { source: 'twitch', id: 'worker', redirect: '/twitch/queue' },
  }, { service: 'twitch', instanceId: 'worker', reason: 'worker-offline' });
}
