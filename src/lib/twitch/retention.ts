import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getJellyfinClientForUser } from '@/lib/service-helpers';
import { ACTIVE_JOB_STATES } from '@/lib/twitch/jobs';
import { decideForVideo } from '@/lib/twitch/policy-store';

const DAY_MS = 86_400_000;

export interface RetentionCandidate {
  fileId: string;
  title: string;
  streamer: string;
  sizeBytes: number;
  reason: string;
}

// Only a real answer counts: an unreachable Jellyfin means nothing is known to be
// watched, so the watched rule deletes nothing.
async function loadPlayedDates(
  user: { role: string; jellyfinUserId: string | null } | null,
  itemIds: string[],
): Promise<Map<string, Date>> {
  const played = new Map<string, Date>();
  if (!user || itemIds.length === 0) return played;
  try {
    const client = await getJellyfinClientForUser(user as Parameters<typeof getJellyfinClientForUser>[0]);
    const { Items } = await client.queryItems({ Ids: itemIds.join(','), Fields: 'UserData', EnableUserData: true });
    for (const item of Items ?? []) {
      const { Played, LastPlayedDate } = item.UserData ?? {};
      if (Played && LastPlayedDate) played.set(item.Id, new Date(LastPlayedDate));
    }
  } catch (error) {
    logger.warn('Twitch retention could not read watched state', { error: String(error) }, { scope: 'twitch' });
  }
  return played;
}

/** What the rules would delete right now. Reads only; also the check made again before any delete. */
export async function findRetentionCandidates(
  user: { role: string; jellyfinUserId: string | null } | null,
  now = new Date(),
): Promise<RetentionCandidate[]> {
  const files = await prisma.twitchMediaFile.findMany({
    where: {
      keepForever: false,
      jobs: { none: { state: { in: ACTIVE_JOB_STATES } } },
      video: { jobs: { none: { state: { in: ACTIVE_JOB_STATES } } } },
    },
    select: {
      id: true,
      sizeBytes: true,
      createdAt: true,
      jellyfinItemId: true,
      video: {
        select: {
          title: true, type: true, category: true, streamerId: true, durationSeconds: true, twitchCreatedAt: true,
          streamer: { select: { displayName: true } },
        },
      },
    },
    orderBy: { video: { twitchCreatedAt: 'desc' } },
  });
  const played = await loadPlayedDates(user, files.flatMap((file) => file.jellyfinItemId ?? []));

  const seen = new Map<string, number>();
  const candidates: RetentionCandidate[] = [];
  for (const file of files) {
    const { policy } = await decideForVideo(file.video);
    const rank = (seen.get(`${file.video.streamerId}:${file.video.type}`) ?? 0) + 1;
    seen.set(`${file.video.streamerId}:${file.video.type}`, rank);

    let reason: string | null = null;
    const watchedAt = file.jellyfinItemId ? played.get(file.jellyfinItemId) : undefined;
    if (policy.keepLatest !== null && rank > policy.keepLatest) {
      reason = `older than the latest ${policy.keepLatest}`;
    } else if (policy.deleteAfterDays !== null && now.getTime() - file.createdAt.getTime() > policy.deleteAfterDays * DAY_MS) {
      reason = `saved more than ${policy.deleteAfterDays} days ago`;
    } else if (policy.deleteAfterWatchedDays !== null && watchedAt && now.getTime() - watchedAt.getTime() > policy.deleteAfterWatchedDays * DAY_MS) {
      reason = `watched more than ${policy.deleteAfterWatchedDays} days ago`;
    }
    if (reason) {
      candidates.push({
        fileId: file.id,
        title: file.video.title,
        streamer: file.video.streamer.displayName,
        sizeBytes: Number(file.sizeBytes),
        reason,
      });
    }
  }
  return candidates;
}

/** Helprr has no file access: the worker deletes, and audits under this actor. */
export async function enqueueFileDelete(
  fileId: string,
  actor: { id: string; username: string },
  origin: { retention?: boolean } = {},
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`twitch-delete:${fileId}`}))`;
    const file = await tx.twitchMediaFile.findUnique({ where: { id: fileId }, select: { videoId: true } });
    if (!file) return false;
    const active = await tx.twitchJob.findFirst({
      where: { mediaFileId: fileId, kind: 'DELETE_FILES', state: { in: ACTIVE_JOB_STATES } },
      select: { id: true },
    });
    if (active) return true;
    await tx.twitchJob.create({
      data: {
        kind: 'DELETE_FILES',
        options: origin,
        videoId: file.videoId,
        mediaFileId: fileId,
        requestedByUserId: actor.id,
        requestedByUsername: actor.username,
      },
    });
    return true;
  });
}
