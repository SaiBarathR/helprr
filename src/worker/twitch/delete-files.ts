import { constants } from 'node:fs';
import { open, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient, TwitchJob } from '@prisma/client';
import { LIBRARY_DIR } from './env';
import { DeferJobError } from './process';
import { recordDeletion, writeDeleteAudit } from './reencode';

/** Stored paths are the worker's own, but a delete is the last place to take that on trust. */
export function insideLibrary(relativePath: string, root = LIBRARY_DIR): string {
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new Error(`validation failed: ${relativePath} is outside the library`);
  }
  return resolved;
}

const LIBRARY_MARKER = '.helprr-library';
const CONFLICT_WAIT_MS = 5 * 60_000;
// Rules can change while a job waits, and only the app can re-read them: past this, ask again.
const RETENTION_DELETE_VALID_MS = 10 * 60_000;
export const IN_PROGRESS = ['QUEUED', 'BLOCKED', 'RUNNING', 'RETRY_WAIT'] as const;

/** The API's delete leaves sidecars behind, so the whole set goes here, and is audited either way. */
export async function runDeleteFiles(prisma: PrismaClient, job: TwitchJob): Promise<void> {
  if (!job.mediaFileId) return;
  const file = await prisma.twitchMediaFile.findUnique({
    where: { id: job.mediaFileId },
    include: { video: { select: { title: true, twitchVideoId: true, streamer: { select: { displayName: true } } } } },
  });
  if (!file) return;
  // Keep forever stops the rules. A person confirming this one file overrides it.
  const origin = job.options as { retention?: boolean; reason?: string } | null;
  const fromRetention = origin?.retention === true;
  if (fromRetention && file.keepForever) throw new Error('validation failed: this file is marked keep forever');
  if (fromRetention && Date.now() - job.createdAt.getTime() > RETENTION_DELETE_VALID_MS) {
    throw new Error('validation failed: this retention delete waited too long, so preview again');
  }
  const busy = await prisma.twitchJob.count({
    where: {
      id: { not: job.id },
      state: { in: [...IN_PROGRESS] },
      kind: { not: 'DELETE_FILES' },
      OR: [{ mediaFileId: file.id }, { videoId: file.videoId }],
    },
  });
  if (busy > 0) {
    // A retention delete yields for good: the file is in use again, so it is no longer a candidate.
    if (fromRetention) throw new Error('validation failed: this file is in use again');
    throw new DeferJobError('waiting for other jobs', CONFLICT_WAIT_MS);
  }

  const sidecars = Array.isArray(file.sidecars) ? file.sidecars.filter((entry): entry is string => typeof entry === 'string') : [];
  const paths = [file.relativePath, ...sidecars, ...(file.originalRelativePath ? [file.originalRelativePath] : [])];
  const startedAt = new Date();
  let errorMessage: string | null = null;
  try {
    const freedBytes = await sizeOnDisk(paths);
    for (const relative of paths) await removeInsideLibrary(relative);
    await prisma.twitchMediaFile.delete({ where: { id: file.id } });
    await recordDeletion(prisma, {
      videoId: file.videoId,
      title: file.video.title,
      streamer: file.video.streamer.displayName,
      kind: 'FILE',
      cause: fromRetention ? 'RULE' : 'PERSON',
      detail: origin?.reason,
      freedBytes,
      deletedBy: job.requestedByUsername,
    });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  await writeDeleteAudit(prisma, {
    title: file.video.title,
    fileCount: paths.length,
    details: { kind: 'twitch-file', twitchVideoId: file.video.twitchVideoId, paths },
    startedAt,
    errorMessage,
    actor: job.requestedByUsername ? { id: job.requestedByUserId, username: job.requestedByUsername } : undefined,
  });
  if (errorMessage) throw new Error(errorMessage);
  await prisma.twitchJob.update({ where: { id: job.id }, data: { needsJellyfinRefresh: true } });
}

/**
 * Files from before group write was on. Walks once at start, and touches only what differs.
 * Everything goes through handles opened with no-follow, and folders are listed through
 * their handle: other users of this group can write here, so a path could turn into a
 * symlink between looking at it and using it.
 */
export async function repairLibraryModes(target: string): Promise<number> {
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
  if (!handle) return 0;
  try {
    const info = await handle.stat();
    if (!info.isFile() && !info.isDirectory()) return 0;
    let fixed = 0;
    if ((info.mode & 0o020) === 0) {
      // Keeps setgid: without it, a folder made here would stop sharing the group.
      await handle.chmod((info.mode & 0o7777) | 0o020);
      fixed += 1;
    }
    if (info.isDirectory()) {
      const self = `/proc/self/fd/${handle.fd}`;
      for (const entry of await readdir(self, { withFileTypes: true })) {
        if (!entry.isSymbolicLink()) fixed += await repairLibraryModes(path.join(self, entry.name));
      }
    }
    return fixed;
  } finally {
    await handle.close();
  }
}

async function sizeOnDisk(paths: string[]): Promise<number> {
  const sizes = await Promise.all(paths.map((relative) => stat(insideLibrary(relative)).then(({ size }) => size, () => 0)));
  return sizes.reduce((total, size) => total + size, 0);
}

/** Only a clear "not there" counts: any other error says nothing about the file. */
export async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** The stored path stays inside the library by its text; a linked folder could still lead out. */
export async function assertRealParentInside(relative: string): Promise<void> {
  const parent = await realpath(path.dirname(insideLibrary(relative)));
  const root = await realpath(LIBRARY_DIR);
  if (parent !== root && !parent.startsWith(`${root}${path.sep}`)) {
    throw new Error(`validation failed: ${relative} leads outside the library`);
  }
}

export async function removeInsideLibrary(relative: string): Promise<void> {
  try {
    await assertRealParentInside(relative);
  } catch (error) {
    // Its folder is already gone, so it is too. Anything else leaves the file in doubt.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await rm(insideLibrary(relative), { force: true });
}

/**
 * A video removed in Jellyfin is gone from the disk, but Helprr still lists it as saved.
 * The marker proves this is the real library: on an unmounted disk the folder is empty,
 * and every file would look deleted. It is only written once a file has been seen there.
 */
export async function forgetFilesDeletedElsewhere(prisma: PrismaClient): Promise<number> {
  const files = await prisma.twitchMediaFile.findMany({
    where: { jobs: { none: { state: { in: [...IN_PROGRESS] } } } },
    include: { video: { select: { title: true, twitchVideoId: true, streamer: { select: { displayName: true } } } } },
  });
  const missing = [];
  for (const file of files) {
    if (!(await exists(insideLibrary(file.relativePath)))) missing.push(file);
  }

  const marker = path.join(LIBRARY_DIR, LIBRARY_MARKER);
  if (missing.length < files.length) await writeFile(marker, '');
  if (missing.length === 0 || !(await exists(marker))) return 0;

  for (const file of missing) {
    const sidecars = Array.isArray(file.sidecars) ? file.sidecars.filter((entry): entry is string => typeof entry === 'string') : [];
    const leftovers = [...sidecars, ...(file.originalRelativePath ? [file.originalRelativePath] : [])];
    const startedAt = new Date();
    const freedBytes = await sizeOnDisk(leftovers);
    for (const relative of leftovers) await removeInsideLibrary(relative);
    await prisma.twitchMediaFile.delete({ where: { id: file.id } });
    await recordDeletion(prisma, {
      videoId: file.videoId,
      title: file.video.title,
      streamer: file.video.streamer.displayName,
      kind: 'FILE',
      cause: 'OUTSIDE',
      freedBytes: freedBytes + Number(file.sizeBytes),
    });
    await writeDeleteAudit(prisma, {
      title: file.video.title,
      fileCount: leftovers.length,
      details: { kind: 'deleted-outside-helprr', twitchVideoId: file.video.twitchVideoId, paths: leftovers },
      startedAt,
      errorMessage: null,
    });
  }
  return missing.length;
}
