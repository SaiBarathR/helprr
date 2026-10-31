import { lstat, stat } from 'node:fs/promises';
import type { PrismaClient, TwitchJob } from '@prisma/client';
import { IN_PROGRESS } from './delete-files';
import { withFileLock } from './file-lock';
import { existsInLibrary, insideLibrary, removeInsideLibrary, replaceInsideLibrary } from './library-paths';
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

/**
 * Each job is for the re-encode it was asked about. Once that one is undone or replaced, the
 * job has nothing to do: not a retry after it already finished, nor a stalled worker waking up
 * after a later re-encode has parked a new original under the same name.
 */
function isCurrent(job: TwitchJob, file: { reencodedAt: Date | null }): boolean {
  const { generation } = job.options as { generation?: string | null };
  return (file.reencodedAt?.toISOString() ?? null) === (generation ?? null);
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
export async function runDeleteOriginal(prisma: PrismaClient, job: TwitchJob, assertLease: () => Promise<void>): Promise<void> {
  const file = await loadFile(prisma, job);
  if (!file || !isCurrent(job, file)) return;
  await waitForOtherWork(prisma, job, file);
  const relative = file.originalRelativePath;
  if (!relative) return;

  const startedAt = new Date();
  let errorMessage: string | null = null;
  let done = false;
  try {
    const freedBytes = (await lstat(insideLibrary(relative)).catch(() => null))?.size ?? 0;
    done = await withFileLock(prisma, file.id, async (tx) => {
      const current = await tx.twitchMediaFile.findUnique({ where: { id: file.id }, select: { reencodedAt: true, originalRelativePath: true } });
      if (!current || !isCurrent(job, current) || current.originalRelativePath !== relative) return false;
      await assertLease();
      await removeInsideLibrary(relative);
      await tx.twitchMediaFile.update({
        where: { id: file.id },
        data: { originalRelativePath: null, originalDeleteAfter: null, originalDeletedAt: startedAt },
      });
      return true;
    });
    if (done) {
      await recordDeletion(prisma, {
        videoId: file.videoId,
        title: file.video.title,
        streamer: file.video.streamer.displayName,
        kind: 'ORIGINAL',
        cause: 'PERSON',
        freedBytes,
        deletedBy: job.requestedByUsername,
      });
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  if (done || errorMessage) {
    await writeDeleteAudit(prisma, {
      title: file.video.title,
      fileCount: 1,
      details: { kind: 'original-deleted-by-request', twitchVideoId: file.video.twitchVideoId, paths: [relative] },
      startedAt,
      errorMessage,
      actor: actorOf(job),
    });
  }
  if (errorMessage) throw new Error(errorMessage);
}

/** Replacing the playable copy is final, so the original has to prove itself first. */
async function verifyOriginal(
  parked: string,
  file: { originalSizeBytes: bigint | null; durationSeconds: number },
): Promise<string> {
  const info = await lstat(parked);
  if (!info.isFile()) throw new Error('validation failed: the original is not a regular file');
  if (file.originalSizeBytes !== null && BigInt(info.size) !== file.originalSizeBytes) {
    throw new Error('validation failed: the original has changed size since it was parked');
  }
  const { codec, duration } = await probe(parked);
  if (Math.abs(duration - file.durationSeconds) > Math.max(10, file.durationSeconds * 0.01)) {
    throw new Error(`validation failed: the original runs ${duration}s of ${file.durationSeconds}s`);
  }
  return codec;
}

/**
 * Undoes a re-encode. One rename over the same name, so the video is never missing and
 * Jellyfin keeps the item, its watched state and the resume point. The row and the refresh
 * are written together, so a restart either finds the job undone or finds it finished.
 */
export async function runRestoreOriginal(prisma: PrismaClient, job: TwitchJob, assertLease: () => Promise<void>): Promise<void> {
  const file = await loadFile(prisma, job);
  if (!file || !isCurrent(job, file)) return;
  await waitForOtherWork(prisma, job, file);
  const relative = file.originalRelativePath;
  if (!relative) throw new Error('validation failed: there is no original to restore');

  const target = insideLibrary(file.relativePath);
  const startedAt = new Date();
  const audit = {
    title: file.video.title,
    fileCount: 1,
    details: { kind: 'original-restored-by-request', twitchVideoId: file.video.twitchVideoId, paths: [file.relativePath, relative] },
    startedAt,
    actor: actorOf(job),
  };
  // True from the rename on, whatever fails after it: the re-encoded copy is gone by then.
  let replaced = false;
  try {
    const stillParked = await existsInLibrary(relative);
    let codec: string;
    if (stillParked) {
      codec = await verifyOriginal(insideLibrary(relative), file);
    } else {
      // Anything but HEVC here means a restart after the rename: the original is in place, and the row never heard.
      ({ codec } = await probe(target));
      if (codec === 'hevc') throw new Error('validation failed: the original is gone');
    }

    await withFileLock(prisma, file.id, async (tx) => {
      const current = await tx.twitchMediaFile.findUnique({ where: { id: file.id }, select: { reencodedAt: true, originalRelativePath: true } });
      if (!current || !isCurrent(job, current) || current.originalRelativePath !== relative) return;
      await assertLease();
      if (stillParked) {
        await replaceInsideLibrary(relative, file.relativePath);
        replaced = true;
      }
      const { size } = await stat(target);
      await tx.twitchMediaFile.update({
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
      await tx.twitchJob.update({ where: { id: job.id }, data: { needsJellyfinRefresh: true } });
      // In the same commit, so a restart after it cannot leave the restore off the record.
      await writeDeleteAudit(tx, { ...audit, errorMessage: null, filesDeleted: true });
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await writeDeleteAudit(prisma, { ...audit, errorMessage, filesDeleted: replaced });
    throw new Error(errorMessage);
  }
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
