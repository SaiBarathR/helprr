import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient, TwitchJob } from '@prisma/client';
import { LIBRARY_DIR } from './env';
import { writeDeleteAudit } from './reencode';

/** Stored paths are the worker's own, but a delete is the last place to take that on trust. */
export function insideLibrary(relativePath: string, root = LIBRARY_DIR): string {
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new Error(`validation failed: ${relativePath} is outside the library`);
  }
  return resolved;
}

/** The API's delete leaves sidecars behind, so the whole set goes here, and is audited either way. */
export async function runDeleteFiles(prisma: PrismaClient, job: TwitchJob): Promise<void> {
  if (!job.mediaFileId) return;
  const file = await prisma.twitchMediaFile.findUnique({
    where: { id: job.mediaFileId },
    include: { video: { select: { title: true, twitchVideoId: true } } },
  });
  if (!file) return;
  if (file.keepForever) throw new Error('validation failed: this file is marked keep forever');

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
