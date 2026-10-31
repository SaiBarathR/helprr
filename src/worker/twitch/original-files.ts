import { rename, stat } from 'node:fs/promises';
import type { PrismaClient, TwitchJob } from '@prisma/client';
import { assertRealParentInside, exists, insideLibrary, IN_PROGRESS, removeInsideLibrary } from './delete-files';
import { DeferJobError } from './process';
import { probe, recordDeletion, writeDeleteAudit } from './reencode';

const CONFLICT_WAIT_MS = 5 * 60_000;

async function loadFile(prisma: PrismaClient, job: TwitchJob) {
  if (!job.mediaFileId) return null;
  return prisma.twitchMediaFile.findUnique({
    where: { id: job.mediaFileId },
    include: { video: { select: { title: true, twitchVideoId: true, streamer: { select: { displayName: true } } } } },
  });
}

// Not DELETE_FILES: that job waits for this one, so waiting back would never end.
async function waitForOtherWork(prisma: PrismaClient, job: TwitchJob, file: { id: string; videoId: string }): Promise<void> {
  const busy = await prisma.twitchJob.count({
    where: {
      id: { not: job.id },
      state: { in: [...IN_PROGRESS] },
      kind: { in: ['DOWNLOAD', 'REENCODE'] },
      OR: [{ mediaFileId: file.id }, { videoId: file.videoId }],
    },
  });
  if (busy > 0) throw new DeferJobError('waiting for other jobs', CONFLICT_WAIT_MS);
}

const actorOf = (job: TwitchJob) => (
  job.requestedByUsername ? { id: job.requestedByUserId, username: job.requestedByUsername } : undefined
);

/** Frees the space early. The re-encoded file stays, and this cannot be undone. */
export async function runDeleteOriginal(prisma: PrismaClient, job: TwitchJob): Promise<void> {
  const file = await loadFile(prisma, job);
  if (!file) return;
  await waitForOtherWork(prisma, job, file);
  const relative = file.originalRelativePath;
  if (!relative) return;

  const startedAt = new Date();
  let errorMessage: string | null = null;
  try {
    const freedBytes = (await stat(insideLibrary(relative)).catch(() => null))?.size ?? 0;
    await removeInsideLibrary(relative);
    await prisma.twitchMediaFile.update({
      where: { id: file.id },
      data: { originalRelativePath: null, originalDeleteAfter: null, originalDeletedAt: startedAt },
    });
    await recordDeletion(prisma, {
      videoId: file.videoId,
      title: file.video.title,
      streamer: file.video.streamer.displayName,
      kind: 'ORIGINAL',
      cause: 'PERSON',
      freedBytes,
      deletedBy: job.requestedByUsername,
    });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  await writeDeleteAudit(prisma, {
    title: file.video.title,
    fileCount: 1,
    details: { kind: 'original-deleted-by-request', twitchVideoId: file.video.twitchVideoId, paths: [relative] },
    startedAt,
    errorMessage,
    actor: actorOf(job),
  });
  if (errorMessage) throw new Error(errorMessage);
}

/**
 * Undoes a re-encode. One rename over the same name, so the video is never missing and
 * Jellyfin keeps the item, its watched state and the resume point.
 */
export async function runRestoreOriginal(prisma: PrismaClient, job: TwitchJob): Promise<void> {
  const file = await loadFile(prisma, job);
  if (!file) return;
  await waitForOtherWork(prisma, job, file);
  const relative = file.originalRelativePath;
  if (!relative) throw new Error('validation failed: there is no original to restore');

  const target = insideLibrary(file.relativePath);
  const parked = insideLibrary(relative);
  if (await exists(parked)) {
    await assertRealParentInside(relative);
    await assertRealParentInside(file.relativePath);
    await rename(parked, target);
  } else if ((await probe(target)).codec === 'hevc') {
    // Anything else means a restart after the rename: the original is in place, and the row never heard.
    throw new Error('validation failed: the original is gone');
  }

  const [{ size }, { codec }] = await Promise.all([stat(target), probe(target)]);
  await prisma.twitchMediaFile.update({
    where: { id: file.id },
    data: {
      sizeBytes: BigInt(size),
      videoCodec: codec,
      reencodedAt: null,
      reencodeQuality: null,
      originalRelativePath: null,
      originalDeleteAfter: null,
      originalSizeBytes: null,
      originalVideoCodec: null,
    },
  });
  await prisma.twitchJob.update({ where: { id: job.id }, data: { needsJellyfinRefresh: true } });
}

/** For files re-encoded before sizes were kept: the parked copy still has the answer. */
export async function measureParkedOriginals(prisma: PrismaClient): Promise<number> {
  const files = await prisma.twitchMediaFile.findMany({
    where: { originalRelativePath: { not: null }, originalSizeBytes: null },
    select: { id: true, originalRelativePath: true },
  });
  let measured = 0;
  for (const file of files) {
    const info = await stat(insideLibrary(file.originalRelativePath!)).catch(() => null);
    if (!info) continue;
    await prisma.twitchMediaFile.update({ where: { id: file.id }, data: { originalSizeBytes: BigInt(info.size) } });
    measured += 1;
  }
  return measured;
}
