import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ArchivePlatform, Prisma, PrismaClient, ArchiveDeletionCause, ArchiveDeletionKind, ArchiveJob } from '@prisma/client';
import { worthKeeping } from '@/lib/archive/reencode-window';
import { FFMPEG, FFPROBE, libraryFor } from './env';
import { withFileLock } from './file-lock';
import { removeInsideLibrary, replaceInsideLibrary } from './library-paths';
import { JobCancelledError, run } from './process';

const RENDER_DEVICE = '/dev/dri/renderD128';
const NICE = 10;
const PROGRESS_INTERVAL_MS = 5_000;
const HW_ARGS = ['-init_hw_device', `vaapi=va:${RENDER_DEVICE}`, '-init_hw_device', 'qsv=qs@va', '-filter_hw_device', 'qs'];

/** A one-frame encode: the only honest answer to whether QSV works here. */
export async function probeGpu(): Promise<boolean> {
  try {
    await run(FFMPEG, [
      '-v', 'error', ...HW_ARGS, '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=0.04',
      '-vf', 'format=nv12,hwupload=extra_hw_frames=8', '-frames:v', '1', '-c:v', 'hevc_qsv', '-f', 'null', '-',
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads ffmpeg's `-progress` output: one key=value a line, each block closed by a
 * `progress=` line. Time left comes from ffmpeg's own speed, as a multiple of real time.
 */
export function encodeProgressReader(
  durationSeconds: number,
  onBlock: (progress: number, etaSeconds: number | null) => void,
): (line: string) => void {
  let doneSeconds = 0;
  let speed = 0;
  return (line) => {
    const split = line.indexOf('=');
    if (split < 0) return;
    const key = line.slice(0, split);
    const value = line.slice(split + 1).trim();
    if (key === 'out_time_us') {
      const micros = Number(value);
      if (Number.isFinite(micros)) doneSeconds = Math.max(0, micros / 1_000_000);
    } else if (key === 'speed') {
      speed = Number.parseFloat(value) || 0;
    } else if (key === 'progress' && durationSeconds > 0) {
      const left = Math.max(0, durationSeconds - doneSeconds);
      onBlock(Math.min(1, doneSeconds / durationSeconds), speed > 0 ? Math.round(left / speed) : null);
    }
  };
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(() => true, () => false);
}

interface Probed {
  duration: number;
  codec: string;
}

export async function probe(file: string): Promise<Probed> {
  const output = await run(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', file,
  ], { captureStdout: true });
  const data = JSON.parse(output) as { streams: Array<{ codec_name: string }>; format: { duration?: string } };
  return { duration: Number(data.format.duration ?? 0), codec: data.streams[0]?.codec_name ?? 'unknown' };
}

export async function runReencode(ctx: {
  prisma: PrismaClient;
  job: ArchiveJob;
  signal: AbortSignal;
  quality: number;
  preset: string;
  keepOriginalDays: number;
  setStage: (stage: string) => Promise<void>;
  note: (message: string) => Promise<void>;
  assertLease: () => Promise<void>;
  stagingName: string;
}): Promise<void> {
  const { prisma, job, signal } = ctx;
  if (!job.mediaFileId) throw new Error('validation failed: re-encode has no file');
  const file = await prisma.archiveMediaFile.findUniqueOrThrow({ where: { id: job.mediaFileId } });

  const library = libraryFor(file.platform);
  const { root } = library;
  const target = path.join(root, file.relativePath);
  const parked = path.join(library.originals, file.relativePath);

  const parkedRelative = path.relative(root, parked);
  // A crash between the two renames below left the file parked with nothing in its place.
  if (!(await exists(target)) && (await exists(parked))) await replaceInsideLibrary(parkedRelative, file.relativePath, root);
  if (!(await exists(target))) throw new Error('validation failed: the file is gone');

  const before = await probe(target);
  if (before.codec === 'hevc') {
    // A crash right after the swap: the file is in place, but the row never heard.
    if (!file.originalRelativePath && (await exists(parked))) {
      const { size } = await stat(target);
      const { size: originalBytes } = await stat(parked);
      await recordSwap(ctx, file.id, parkedRelative, { sizeBytes: size, originalBytes, originalCodec: null });
      await ctx.note('Finished a swap interrupted by a restart');
      return;
    }
    await ctx.note('Already HEVC');
    return;
  }

  const staging = path.join(library.staging, ctx.stagingName);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const encoded = path.join(staging, 'out.mkv');

  await ctx.setStage('encoding');
  let lastWrite = 0;
  // One write at a time: a slow database skips saves rather than queueing them.
  let writing: Promise<unknown> | null = null;
  const save = (progress: number, etaSeconds: number | null) => {
    if (writing || Date.now() - lastWrite < PROGRESS_INTERVAL_MS) return;
    lastWrite = Date.now();
    writing = prisma.archiveJob.update({ where: { id: job.id }, data: { progress, etaSeconds } })
      .catch(() => undefined)
      .finally(() => { writing = null; });
  };
  // Each attempt reads its own ffmpeg from zero.
  const encode = (decoding: string[], filtering: string[]) => run(FFMPEG, [
    '-y', '-v', 'error', '-nostats', '-progress', 'pipe:1', ...HW_ARGS, ...decoding, '-i', target,
    '-map', '0:v:0', '-map', '0:a', '-map_metadata', '0', '-map_chapters', '0', ...filtering,
    '-c:v', 'hevc_qsv', '-preset', ctx.preset, '-global_quality', String(ctx.quality), '-c:a', 'copy', encoded,
  ], { signal, nice: NICE, onStdoutLine: encodeProgressReader(before.duration, save) });
  try {
    await encode(['-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv'], []);
  } catch (error) {
    if (error instanceof JobCancelledError) throw error;
    // Some streams change a property part way, such as the aspect ratio flag. The hardware
    // decoder restarts at that point and ffmpeg cannot follow it, and rebuilding the filters
    // for the upload to the GPU fails the same way, so they stay as they are. The GPU still
    // encodes, and a stream that really changed size fails here, with the original untouched.
    await ctx.note('Hardware decoding failed, so this encode decodes in software');
    lastWrite = 0;
    await encode(['-reinit_filter', '0'], ['-vf', 'format=nv12,hwupload=extra_hw_frames=64']);
  } finally {
    // A write still in flight must not land on top of the finished job.
    await writing;
  }

  await ctx.setStage('validating');
  const after = await probe(encoded);
  const { size: originalBytes } = await stat(target);
  const { size: encodedBytes } = await stat(encoded);
  if (after.codec !== 'hevc' || Math.abs(after.duration - before.duration) > Math.max(10, before.duration * 0.01)) {
    throw new Error(`validation failed: re-encode came out ${after.codec}, ${after.duration}s of ${before.duration}s`);
  }
  // Someone asked for this on YouTube for a player's sake, knowing it usually grows the file.
  if (file.platform !== 'YOUTUBE' && !worthKeeping(originalBytes, encodedBytes)) {
    await rm(staging, { recursive: true, force: true });
    await ctx.note(`Kept the original: ${encodedBytes} bytes is not 10% under ${originalBytes}`);
    await prisma.archiveMediaFile.update({
      where: { id: file.id },
      data: { reencodeSkippedAt: new Date(), reencodeSkippedBytes: BigInt(encodedBytes) },
    });
    return;
  }

  // Same name, so Jellyfin keeps the item, its watched state and the resume point.
  await ctx.assertLease();
  await ctx.setStage('swapping');
  await mkdir(path.dirname(parked), { recursive: true });
  await replaceInsideLibrary(file.relativePath, parkedRelative, root);
  try {
    await replaceInsideLibrary(path.relative(root, encoded), file.relativePath, root);
  } catch (error) {
    await replaceInsideLibrary(parkedRelative, file.relativePath, root);
    throw error;
  }

  await recordSwap(ctx, file.id, parkedRelative, { sizeBytes: encodedBytes, originalBytes, originalCodec: before.codec });
  await rm(staging, { recursive: true, force: true });
}

async function recordSwap(
  ctx: { prisma: PrismaClient; job: ArchiveJob; keepOriginalDays: number; quality: number },
  fileId: string,
  parkedRelative: string,
  sizes: { sizeBytes: number; originalBytes: number; originalCodec: string | null },
): Promise<void> {
  await ctx.prisma.archiveMediaFile.update({
    where: { id: fileId },
    data: {
      sizeBytes: BigInt(sizes.sizeBytes),
      videoCodec: 'hevc',
      reencodedAt: new Date(),
      reencodeQuality: ctx.quality,
      reencodeSkippedAt: null,
      reencodeSkippedBytes: null,
      originalRelativePath: parkedRelative,
      originalDeleteAfter: new Date(Date.now() + ctx.keepOriginalDays * 86_400_000),
      originalSizeBytes: BigInt(sizes.originalBytes),
      originalVideoCodec: sizes.originalCodec,
      originalDeletedAt: null,
    },
  });
  await ctx.prisma.archiveJob.update({ where: { id: ctx.job.id }, data: { needsJellyfinRefresh: true } });
}

/** Deletes originals past their date. Every removal is audited, by a system actor. */
export async function deleteExpiredOriginals(prisma: PrismaClient, platform: ArchivePlatform, now = new Date()): Promise<number> {
  const { root } = libraryFor(platform);
  const due = await prisma.archiveMediaFile.findMany({
    // A job on the file may be about to restore this very original.
    where: {
      platform,
      originalRelativePath: { not: null },
      originalDeleteAfter: { lte: now },
      jobs: { none: { state: { in: ['QUEUED', 'BLOCKED', 'RUNNING', 'RETRY_WAIT'] } } },
    },
    include: { video: { select: { title: true, creator: { select: { displayName: true } } } } },
  });
  let deleted = 0;
  for (const file of due) {
    const startedAt = new Date();
    let errorMessage: string | null = null;
    let done = false;
    try {
      const original = path.join(root, file.originalRelativePath!);
      const freedBytes = (await stat(original).catch(() => null))?.size ?? 0;
      // The list above can be old by now: a restore may have been accepted, or a new
      // re-encode may have parked a newer original under this same name.
      done = await withFileLock(prisma, file.id, async (tx) => {
        const current = await tx.archiveMediaFile.findUnique({
          where: { id: file.id },
          select: {
            originalRelativePath: true,
            originalDeleteAfter: true,
            jobs: { where: { state: { in: ['QUEUED', 'BLOCKED', 'RUNNING', 'RETRY_WAIT'] } }, select: { id: true }, take: 1 },
          },
        });
        if (
          !current
          || current.originalRelativePath !== file.originalRelativePath
          || !current.originalDeleteAfter
          || current.originalDeleteAfter > now
          || current.jobs.length > 0
        ) return false;
        await removeInsideLibrary(file.originalRelativePath!, root);
        await tx.archiveMediaFile.update({
          where: { id: file.id },
          data: { originalRelativePath: null, originalDeleteAfter: null, originalDeletedAt: now },
        });
        return true;
      });
      if (done) {
        await recordDeletion(prisma, {
          platform: file.platform,
          videoId: file.videoId,
          title: file.video.title,
          streamer: file.video.creator.displayName,
          kind: 'ORIGINAL',
          cause: 'KEEP_PERIOD',
          freedBytes,
        });
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    if (!done && !errorMessage) continue;
    deleted += 1;
    await writeDeleteAudit(prisma, {
      platform: file.platform,
      title: file.video.title,
      fileCount: 1,
      details: { kind: 'original-after-reencode', relativePath: file.originalRelativePath },
      startedAt,
      errorMessage,
    });
  }
  return deleted;
}

/** The Library's own record. A failure here must not fail a delete that already happened. */
export async function recordDeletion(prisma: PrismaClient, input: {
  platform: ArchivePlatform;
  videoId: string;
  title: string;
  streamer: string;
  kind: ArchiveDeletionKind;
  cause: ArchiveDeletionCause;
  freedBytes: number;
  detail?: string | null;
  deletedBy?: string | null;
}): Promise<void> {
  try {
    await prisma.archiveDeletedFile.create({ data: { ...input, freedBytes: BigInt(input.freedBytes) } });
  } catch (error) {
    console.error('[TwitchWorker] Failed to record a deletion', error);
  }
}

interface DeleteAudit {
  platform: ArchivePlatform;
  title: string;
  fileCount: number;
  details: Record<string, unknown>;
  startedAt: Date;
  errorMessage: string | null;
  /** When it differs from success: a file can be gone even though a later step failed. */
  filesDeleted?: boolean;
  actor?: { id: string | null; username: string };
}

// recordOperationAudit needs the app's request context, so the same row is written here.
export function deleteAuditRow(input: DeleteAudit): Prisma.FileOperationAuditCreateInput {
  return {
    userId: input.actor?.id ?? null,
    username: input.actor?.username ?? 'system:twitch-worker',
    service: input.platform,
    operation: 'DELETE_MEDIA',
    mediaType: `${input.platform.toLowerCase()}-video`,
    mediaTitle: input.title,
    fileCount: input.fileCount,
    filesDeleted: input.filesDeleted ?? input.errorMessage === null,
    details: input.details as Prisma.InputJsonValue,
    success: input.errorMessage === null,
    errorMessage: input.errorMessage,
    startedAt: input.startedAt,
  };
}

/** Fail-soft, so never inside a transaction: a swallowed error there aborts it without saying so. */
export async function writeDeleteAudit(prisma: PrismaClient, input: DeleteAudit): Promise<void> {
  await prisma.fileOperationAudit.create({ data: deleteAuditRow(input) })
    .catch((error) => console.error('[TwitchWorker] Failed to write audit row', error));
}
