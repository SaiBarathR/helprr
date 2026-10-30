import { chmod, lstat, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient, TwitchJob } from '@prisma/client';
import { LIBRARY_DIR } from './env';
import { DeferJobError } from './process';
import { writeDeleteAudit } from './reencode';

/** Stored paths are the worker's own, but a delete is the last place to take that on trust. */
export function insideLibrary(relativePath: string, root = LIBRARY_DIR): string {
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new Error(`validation failed: ${relativePath} is outside the library`);
  }
  return resolved;
}

const CONFLICT_WAIT_MS = 5 * 60_000;
// Rules can change while a job waits, and only the app can re-read them: past this, ask again.
const RETENTION_DELETE_VALID_MS = 10 * 60_000;
const IN_PROGRESS = ['QUEUED', 'BLOCKED', 'RUNNING', 'RETRY_WAIT'] as const;

/** The API's delete leaves sidecars behind, so the whole set goes here, and is audited either way. */
export async function runDeleteFiles(prisma: PrismaClient, job: TwitchJob): Promise<void> {
  if (!job.mediaFileId) return;
  const file = await prisma.twitchMediaFile.findUnique({
    where: { id: job.mediaFileId },
    include: { video: { select: { title: true, twitchVideoId: true } } },
  });
  if (!file) return;
  if (file.keepForever) throw new Error('validation failed: this file is marked keep forever');

  const fromRetention = (job.options as { retention?: boolean } | null)?.retention === true;
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
    for (const relative of paths) await rm(insideLibrary(relative), { force: true });
    await prisma.twitchMediaFile.delete({ where: { id: file.id } });
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

/** Files from before group write was on. Walks once at start, and touches only what differs. */
export async function repairLibraryModes(dir: string): Promise<number> {
  let fixed = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) fixed += await repairLibraryModes(full);
    if (entry.isSymbolicLink()) continue;
    const { mode } = await lstat(full);
    if ((mode & 0o020) === 0) {
      await chmod(full, (mode & 0o777) | 0o020);
      fixed += 1;
    }
  }
  return fixed;
}

const exists = (file: string) => stat(file).then(() => true, () => false);

/**
 * A video removed in Jellyfin is gone from the disk, but Helprr still lists it as saved.
 * When every file is missing, the likelier story is an unmounted disk, so nothing is
 * forgotten until at least one file can still be found.
 */
export async function forgetFilesDeletedElsewhere(prisma: PrismaClient): Promise<number> {
  const files = await prisma.twitchMediaFile.findMany({
    where: { jobs: { none: { state: { in: [...IN_PROGRESS] } } } },
    include: { video: { select: { title: true, twitchVideoId: true } } },
  });
  const missing = [];
  for (const file of files) {
    if (!(await exists(insideLibrary(file.relativePath)))) missing.push(file);
  }
  if (missing.length === 0 || (missing.length === files.length && files.length > 1)) return 0;

  for (const file of missing) {
    const sidecars = Array.isArray(file.sidecars) ? file.sidecars.filter((entry): entry is string => typeof entry === 'string') : [];
    const leftovers = [...sidecars, ...(file.originalRelativePath ? [file.originalRelativePath] : [])];
    const startedAt = new Date();
    for (const relative of leftovers) await rm(insideLibrary(relative), { force: true });
    await prisma.twitchMediaFile.delete({ where: { id: file.id } });
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
