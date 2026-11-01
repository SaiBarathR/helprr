import type { ArchivePlatform } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { notifyAndLog, errorMessage } from '@/lib/polling/shared';
import { getJellyfinClient } from '@/lib/service-helpers';
import type { NotificationEventType } from '@/lib/notification-events';

const WORKER_OFFLINE_MS = 10 * 60_000;
const REFRESH_GIVE_UP_MS = 30 * 60_000;
const BATCH = 10;

/** What a platform tells the shared steps below. */
export interface ReconcileProfile {
  platform: ArchivePlatform;
  /** Lower case, for dedupe keys, metadata and logs. */
  source: string;
  label: string;
  queueUrl: string;
  completeEvent: NotificationEventType;
  failedEvent: NotificationEventType;
  issueEvent: NotificationEventType;
  /** Null until the Jellyfin library is set up. */
  libraryItemId(): Promise<string | null>;
  /** The tag its NFO writes, which is how the Jellyfin item is found. */
  itemTag(externalId: string): string;
  videoUrl(videoId: string): string;
  toolsPausedAt(): Promise<Date | null>;
}

/** The worker has no Jellyfin access and no push keys, so finished jobs are finished here. */
export async function reconcileJobs(now: Date, profile: ReconcileProfile): Promise<void> {
  await finishPublishedJobs(now, profile);
  await notifyFailedJobs(now, profile);
  await checkToolsPaused(profile);
}

async function checkToolsPaused(profile: ReconcileProfile): Promise<void> {
  const toolsPausedAt = await profile.toolsPausedAt();
  if (!toolsPausedAt) return;
  await notifyAndLog({
    eventType: profile.issueEvent,
    title: `${profile.label} downloads are paused`,
    body: 'Several downloads failed the same way, so the tools may need an update.',
    url: profile.queueUrl,
    dedupeKey: `${profile.source}-tools-paused-${toolsPausedAt.toISOString().slice(0, 10)}`,
    metadata: { source: profile.source, id: 'tools', redirect: profile.queueUrl },
  }, { service: profile.source, instanceId: 'tools', reason: 'tools-paused' });
}

async function subscribersOf(streamerId: string, requestedByUserId: string | null): Promise<string[]> {
  if (requestedByUserId) return [requestedByUserId];
  const subscriptions = await prisma.creatorSubscription.findMany({ where: { creatorId: streamerId }, select: { userId: true } });
  return subscriptions.map((subscription) => subscription.userId);
}

// Kept for the next poll if Jellyfin is away, within limits: nothing to refresh ends it, and so does time.
async function refreshed(
  profile: ReconcileProfile,
  job: { id: string; finishedAt: Date | null },
  refresh: (() => Promise<void>) | null,
  client: unknown,
  now: Date,
): Promise<boolean> {
  if (!refresh) return true;
  if (client) {
    try {
      await refresh();
      return true;
    } catch (error) {
      logger.warn(`${profile.label} Jellyfin refresh failed`, { jobId: job.id, error: errorMessage(error) }, { scope: 'polling' });
    }
  }
  return now.getTime() - (job.finishedAt ?? now).getTime() > REFRESH_GIVE_UP_MS;
}

async function finishPublishedJobs(now: Date, profile: ReconcileProfile): Promise<void> {
  const jobs = await prisma.archiveJob.findMany({
    where: { platform: profile.platform, needsJellyfinRefresh: true, state: 'DONE' },
    orderBy: { finishedAt: 'asc' },
    take: BATCH,
    include: { video: { include: { creator: true } }, mediaFile: { select: { jellyfinItemId: true } } },
  });
  if (jobs.length === 0) return;

  const libraryItemId = await profile.libraryItemId();
  let client: Awaited<ReturnType<typeof getJellyfinClient>> | null = null;
  try {
    client = await getJellyfinClient();
  } catch (error) {
    logger.warn(`${profile.label} cannot reach Jellyfin`, { error: errorMessage(error) }, { scope: 'polling' });
  }

  for (const job of jobs) {
    if (job.kind === 'DELETE_FILES') {
      if (await refreshed(profile, job, libraryItemId ? () => client!.refreshItem(libraryItemId, { recursive: true }) : null, client, now)) {
        await prisma.archiveJob.update({ where: { id: job.id }, data: { needsJellyfinRefresh: false } });
      }
      continue;
    }

    const { video } = job;
    if (!video) {
      await prisma.archiveJob.update({ where: { id: job.id }, data: { needsJellyfinRefresh: false } });
      continue;
    }
    // A swapped file keeps its name, so the item only needs to re-read it. No push: nothing new landed.
    if (job.kind === 'REENCODE' || job.kind === 'RESTORE_ORIGINAL') {
      const known = job.mediaFile?.jellyfinItemId;
      if (await refreshed(profile, job, known ? () => client!.refreshItem(known, { recursive: false }) : null, client, now)) {
        await prisma.archiveJob.update({ where: { id: job.id }, data: { needsJellyfinRefresh: false } });
      }
      continue;
    }

    let itemId: string | null = null;
    if (client && libraryItemId) {
      try {
        // A new streamer has no series yet: refreshing the library finds it.
        const series = await client.queryItems({
          ParentId: libraryItemId, IncludeItemTypes: 'Series', Recursive: true, Fields: 'Path',
        });
        const seriesItem = series.Items?.find((item) => item.Path?.endsWith(`/${video.creator.folderName}`));
        await client.refreshItem(seriesItem?.Id ?? libraryItemId, { recursive: true });

        const found = await client.queryItems({
          ParentId: libraryItemId,
          IncludeItemTypes: 'Episode',
          Recursive: true,
          Tags: profile.itemTag(video.externalId),
        });
        itemId = found.Items?.[0]?.Id ?? null;
      } catch (error) {
        logger.warn(`${profile.label} Jellyfin refresh failed`, { jobId: job.id, error: errorMessage(error) }, { scope: 'polling' });
      }
    }

    const finishedAt = job.finishedAt ?? now;
    const givenUp = now.getTime() - finishedAt.getTime() > REFRESH_GIVE_UP_MS;
    if (!itemId && !givenUp) continue;

    if (itemId) {
      await prisma.archiveMediaFile.updateMany({ where: { videoId: video.id }, data: { jellyfinItemId: itemId } });
    }
    const redirect = itemId ? `/jellyfin/library/item/${itemId}` : profile.videoUrl(video.id);
    for (const userId of await subscribersOf(video.creatorId, job.requestedByUserId)) {
      await notifyAndLog({
        eventType: profile.completeEvent,
        title: `${video.creator.displayName}: download complete`,
        body: video.title.slice(0, 200),
        url: redirect,
        dedupeKey: `${profile.source}-complete-${job.id}-${userId}`,
        userIds: [userId],
        ownerUserId: userId,
        metadata: { source: profile.source, id: video.id, redirect },
      }, { service: profile.source, instanceId: job.id, reason: 'download-complete' });
    }
    await prisma.archiveJob.update({ where: { id: job.id }, data: { needsJellyfinRefresh: false } });
  }
}

async function notifyFailedJobs(now: Date, profile: ReconcileProfile): Promise<void> {
  const jobs = await prisma.archiveJob.findMany({
    where: { platform: profile.platform, state: 'FAILED', kind: 'DOWNLOAD', failureNotifiedAt: null },
    take: BATCH,
    include: { video: { include: { creator: true } } },
  });
  for (const job of jobs) {
    if (job.video) {
      for (const userId of await subscribersOf(job.video.creatorId, job.requestedByUserId)) {
        await notifyAndLog({
          eventType: profile.failedEvent,
          title: `${job.video.creator.displayName}: download failed`,
          body: job.video.title.slice(0, 200),
          url: profile.queueUrl,
          dedupeKey: `${profile.source}-failed-${job.id}-${job.attempts}-${userId}`,
          userIds: [userId],
          ownerUserId: userId,
          metadata: { source: profile.source, id: job.id, redirect: profile.queueUrl },
        }, { service: profile.source, instanceId: job.id, reason: 'download-failed' });
      }
    }
    await prisma.archiveJob.update({ where: { id: job.id }, data: { failureNotifiedAt: now } });
  }
}

/** One worker serves every platform, so this is asked once. */
export async function checkWorker(now: Date): Promise<void> {
  const heartbeat = await prisma.archiveWorkerHeartbeat.findFirst({ orderBy: { lastSeenAt: 'desc' }, select: { lastSeenAt: true } });
  if (heartbeat && now.getTime() - heartbeat.lastSeenAt.getTime() < WORKER_OFFLINE_MS) return;
  // A worker never started is only worth a word once something is waiting for it.
  if (!heartbeat && (await prisma.archiveJob.count({ where: { state: { in: ['QUEUED', 'RUNNING'] } } })) === 0) return;

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
