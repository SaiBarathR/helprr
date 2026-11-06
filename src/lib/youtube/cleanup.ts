import type { Prisma, YoutubeSettings } from '@prisma/client';
import { ACTIVE_JOB_STATES } from '@/lib/archive/jobs';
import { enqueueFileDelete, retentionReason } from '@/lib/archive/retention';
import { prisma } from '@/lib/db';
import { JellyfinClient } from '@/lib/jellyfin-client';
import { logger } from '@/lib/logger';
import { errorMessage, notifyAndLog } from '@/lib/polling/shared';
import { getConnectionHeaders } from '@/lib/service-connection-secrets';
import { buildJellyfinConnectionFingerprint } from '@/lib/service-helpers';
import { YOUTUBE } from '@/lib/youtube/platform';
import { decideForYoutubeVideo, POLICY_VIDEO } from '@/lib/youtube/policy';
import { getYoutubeSettings } from '@/lib/youtube/settings';

export const CLEANUP_ACTOR = 'Automatic cleanup';

const SWEEP_EVERY_MS = 60 * 60_000;
const MAX_PER_SWEEP = 20;
const MAX_PER_DAY = 50;
const ITEMS_PER_READ = 100;
const DAY_MS = 86_400_000;

/** Any doubt ends the sweep here, with the reason shown in Settings. */
class CleanupStopped extends Error {}

// The stored viewer on the stored connection, or nothing. Another user's watched state must
// never stand in, so there is no fallback of any kind.
async function viewerClient(settings: YoutubeSettings): Promise<JellyfinClient> {
  const { cleanupJellyfinUserId: userId, cleanupConnectionId: connectionId, cleanupConnectionFingerprint: fingerprint } = settings;
  if (!userId || !connectionId) throw new CleanupStopped('Choose whose watched videos count.');
  const connection = await prisma.serviceConnection.findUnique({ where: { id: connectionId } });
  // Editing a connection keeps its id, and the same user id can exist on another server.
  if (connection?.type !== 'JELLYFIN' || buildJellyfinConnectionFingerprint(connection) !== fingerprint) {
    throw new CleanupStopped('The Jellyfin connection changed. Choose the viewer again.');
  }
  const client = new JellyfinClient(connection.url, connection.apiKey, userId, getConnectionHeaders(connection));
  await client.getUser(userId).catch(() => {
    throw new CleanupStopped('Could not confirm the viewer in Jellyfin, so nothing was cleared.');
  });
  return client;
}

// Unlike loadPlayedDates this throws, because "could not read" must never look like an answer.
async function readPlayed(client: JellyfinClient, itemIds: string[]): Promise<Map<string, Date>> {
  const played = new Map<string, Date>();
  for (let start = 0; start < itemIds.length; start += ITEMS_PER_READ) {
    const { Items } = await client.queryItems({
      Ids: itemIds.slice(start, start + ITEMS_PER_READ).join(','),
      Fields: 'UserData',
      EnableUserData: true,
    });
    for (const item of Items ?? []) {
      const { Played, LastPlayedDate } = item.UserData ?? {};
      if (Played && LastPlayedDate) played.set(item.Id, new Date(LastPlayedDate));
    }
  }
  return played;
}

async function pause(status: string, now: Date): Promise<void> {
  await prisma.youtubeSettings.updateMany({ data: { autoCleanupEnabled: false, cleanupStatus: status } });
  await notifyAndLog({
    eventType: 'youtubeCleanupPaused',
    title: 'YouTube cleanup paused',
    body: status,
    url: '/settings/youtube',
    dedupeKey: `youtube-cleanup-paused-${now.toISOString().slice(0, 10)}`,
    metadata: { source: 'youtube', id: 'cleanup', redirect: '/settings/youtube' },
  }, { service: 'youtube', instanceId: 'cleanup', reason: 'cleanup-paused' });
}

/**
 * Clears watched videos. Only the watched rule ever runs here: keep latest and delete after N
 * days stay manual, so an unwatched video can never clear by itself. YouTube files only.
 */
export async function sweepWatchedVideos(now = new Date()): Promise<void> {
  const settings = await getYoutubeSettings();
  if (!settings.autoCleanupEnabled) return;
  // Claimed in one update, so two sweeps at once cannot both run.
  const { count } = await prisma.youtubeSettings.updateMany({
    where: { id: 'singleton', OR: [{ cleanupRanAt: null }, { cleanupRanAt: { lte: new Date(now.getTime() - SWEEP_EVERY_MS) } }] },
    data: { cleanupRanAt: now },
  });
  if (count === 0) return;

  try {
    const client = await viewerClient(settings);
    const free = { jobs: { none: { state: { in: ACTIVE_JOB_STATES } } } };
    const files = await prisma.archiveMediaFile.findMany({
      where: { platform: YOUTUBE, keepForever: false, jellyfinItemId: { not: null }, ...free, video: free },
      select: { id: true, createdAt: true, clearsAt: true, jellyfinItemId: true, video: { select: POLICY_VIDEO } },
    });
    const played = await readPlayed(client, files.map((file) => file.jellyfinItemId!));

    const due: Array<{ id: string; itemId: string; reason: string }> = [];
    for (const file of files) {
      const { policy } = await decideForYoutubeVideo(file.video);
      const days = policy.deleteAfterWatchedDays;
      const watchedAt = played.get(file.jellyfinItemId!);
      const clearsAt = days !== null && watchedAt ? new Date(watchedAt.getTime() + days * DAY_MS) : null;
      if (clearsAt?.getTime() !== file.clearsAt?.getTime()) {
        await prisma.archiveMediaFile.updateMany({ where: { id: file.id }, data: { clearsAt } });
      }
      const reason = retentionReason(
        { keepLatest: null, deleteAfterDays: null, deleteAfterWatchedDays: days },
        { rank: 0, savedAt: file.createdAt, watchedAt },
        now,
      );
      if (reason) due.push({ id: file.id, itemId: file.jellyfinItemId!, reason });
    }

    // Read last, and fresh: a video someone has started again stays.
    const sessions = await client.getActiveSessions();
    const playing = new Set(sessions.map((session) => session.NowPlayingItem?.Id));
    const clearing = due.filter((file) => !playing.has(file.itemId));

    const today = await prisma.archiveJob.count({
      where: { platform: YOUTUBE, kind: 'DELETE_FILES', requestedByUsername: CLEANUP_ACTOR, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
    });
    const room = Math.max(0, Math.min(MAX_PER_SWEEP, MAX_PER_DAY - today));
    for (const file of clearing.slice(0, room)) {
      await enqueueFileDelete(file.id, { id: null, username: CLEANUP_ACTOR }, YOUTUBE, {
        retention: true,
        automatic: true,
        generation: settings.cleanupGeneration,
        reason: file.reason,
      });
    }

    // A bad rule must not empty the library over repeated sweeps, so a person has to look.
    if (clearing.length > room) {
      await pause(`Paused: ${clearing.length} videos were due, over the limit of ${MAX_PER_SWEEP} a sweep and ${MAX_PER_DAY} a day. Check your rules, then turn it on again.`, now);
    } else {
      await prisma.youtubeSettings.updateMany({ data: { cleanupStatus: null } });
    }
  } catch (error) {
    const status = error instanceof CleanupStopped ? error.message : 'Could not read what was watched from Jellyfin, so nothing was cleared.';
    logger.warn('YouTube cleanup stopped', { error: errorMessage(error) }, { scope: 'polling' });
    await prisma.youtubeSettings.updateMany({ data: { cleanupStatus: status } });
  }
}

/** Anything already queued was decided under the old rules, so none of it may run. */
export async function invalidateQueuedCleanup(): Promise<void> {
  await prisma.$transaction((tx) => invalidateQueuedCleanupInTxn(tx));
}

/** The same, inside a transaction the caller already holds (a settings import). */
export async function invalidateQueuedCleanupInTxn(tx: Prisma.TransactionClient): Promise<void> {
  await tx.youtubeSettings.updateMany({ data: { cleanupGeneration: { increment: 1 } } });
  await tx.archiveJob.updateMany({
    where: { platform: YOUTUBE, kind: 'DELETE_FILES', state: 'QUEUED', requestedByUsername: CLEANUP_ACTOR },
    data: { state: 'CANCELLED', stage: 'cancelled', finishedAt: new Date() },
  });
}
