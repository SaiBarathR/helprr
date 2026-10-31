import { createHmac, timingSafeEqual } from 'crypto';
import type { TwitchVideoType } from '@prisma/client';
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
export async function loadPlayedDates(
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

interface RetentionLimits {
  keepLatest: number | null;
  deleteAfterDays: number | null;
  deleteAfterWatchedDays: number | null;
}

/** Why the rules would delete a file, or null. `rank` is its place among its streamer's videos of that type, newest first. */
export function retentionReason(
  policy: RetentionLimits,
  file: { rank: number; savedAt: Date; watchedAt?: Date },
  now: Date,
): string | null {
  if (policy.keepLatest !== null && file.rank > policy.keepLatest) {
    return `older than the latest ${policy.keepLatest}`;
  }
  if (policy.deleteAfterDays !== null && now.getTime() - file.savedAt.getTime() > policy.deleteAfterDays * DAY_MS) {
    return `saved more than ${policy.deleteAfterDays} days ago`;
  }
  if (policy.deleteAfterWatchedDays !== null && file.watchedAt && now.getTime() - file.watchedAt.getTime() > policy.deleteAfterWatchedDays * DAY_MS) {
    return `watched more than ${policy.deleteAfterWatchedDays} days ago`;
  }
  return null;
}

/** One file's standing with the rules, for the Library. Reads only. */
export async function fileCleanupStatus(
  file: {
    createdAt: Date;
    keepForever: boolean;
    video: { title: string; type: TwitchVideoType; category: string | null; streamerId: string; durationSeconds: number; twitchCreatedAt: Date };
  },
  watchedAt: Date | undefined,
  now = new Date(),
) {
  const { policy } = await decideForVideo(file.video);
  const { keepLatest, deleteAfterDays, deleteAfterWatchedDays } = policy;
  const rank = await prisma.twitchMediaFile.count({
    where: {
      keepForever: false,
      jobs: { none: { state: { in: ACTIVE_JOB_STATES } } },
      video: {
        streamerId: file.video.streamerId,
        type: file.video.type,
        twitchCreatedAt: { gte: file.video.twitchCreatedAt },
        jobs: { none: { state: { in: ACTIVE_JOB_STATES } } },
      },
    },
  });
  return {
    keepLatest,
    deleteAfterDays,
    deleteAfterWatchedDays,
    deleteAfter: deleteAfterDays === null ? null : new Date(file.createdAt.getTime() + deleteAfterDays * DAY_MS),
    reason: file.keepForever ? null : retentionReason(policy, { rank, savedAt: file.createdAt, watchedAt }, now),
  };
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

    const watchedAt = file.jellyfinItemId ? played.get(file.jellyfinItemId) : undefined;
    const reason = retentionReason(policy, { rank, savedAt: file.createdAt, watchedAt }, now);
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

const PREVIEW_VALID_MS = 10 * 60_000;

function previewSignature(userId: string, fileIds: string[], expires: number): string {
  const secret = process.env.JWT_SECRET || process.env.APP_PASSWORD;
  if (!secret) throw new Error('JWT_SECRET or APP_PASSWORD is required');
  return createHmac('sha256', secret).update(`retention:${userId}:${expires}:${[...fileIds].sort().join(',')}`).digest('base64url');
}

/** Proves a run deletes what this user was shown, recently. */
export function signRetentionPreview(userId: string, fileIds: string[], now = Date.now()): string {
  const expires = now + PREVIEW_VALID_MS;
  return `${expires}.${previewSignature(userId, fileIds, expires)}`;
}

export function verifyRetentionPreview(token: unknown, userId: string, fileIds: string[], now = Date.now()): boolean {
  if (typeof token !== 'string') return false;
  const [expiresText, signature] = token.split('.');
  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || expires < now || !signature) return false;
  const expected = Buffer.from(previewSignature(userId, fileIds, expires));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** The worker can hold a file's lock through deleting a large file, which takes more than Prisma's default 5 s. */
export const FILE_LOCK_TRANSACTION = { maxWait: 10_000, timeout: 30_000 };

/** Helprr has no file access: the worker deletes, and audits under this actor. */
export async function enqueueFileDelete(
  fileId: string,
  actor: { id: string; username: string },
  origin: { retention?: boolean; reason?: string } = {},
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
  }, FILE_LOCK_TRANSACTION);
}
