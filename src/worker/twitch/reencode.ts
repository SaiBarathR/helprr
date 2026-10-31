import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Prisma, PrismaClient, TwitchDeletionCause, TwitchDeletionKind, TwitchJob } from '@prisma/client';
import { worthKeeping } from '@/lib/twitch/reencode-window';
import { FFMPEG, FFPROBE, LIBRARY_DIR, ORIGINALS_DIR, STAGING_DIR } from './env';
import { run } from './process';

const RENDER_DEVICE = '/dev/dri/renderD128';
const NICE = 10;
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
  job: TwitchJob;
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
  const file = await prisma.twitchMediaFile.findUniqueOrThrow({ where: { id: job.mediaFileId } });

  const target = path.join(LIBRARY_DIR, file.relativePath);
  const parked = path.join(ORIGINALS_DIR, file.relativePath);

  // A crash between the two renames below left the file parked with nothing in its place.
  if (!(await exists(target)) && (await exists(parked))) await rename(parked, target);
  if (!(await exists(target))) throw new Error('validation failed: the file is gone');

  const before = await probe(target);
  if (before.codec === 'hevc') {
    // A crash right after the swap: the file is in place, but the row never heard.
    if (!file.originalRelativePath && (await exists(parked))) {
      const { size } = await stat(target);
      const { size: originalBytes } = await stat(parked);
      await recordSwap(ctx, file.id, parked, { sizeBytes: size, originalBytes, originalCodec: null });
      await ctx.note('Finished a swap interrupted by a restart');
      return;
    }
    await ctx.note('Already HEVC');
    return;
  }

  const staging = path.join(STAGING_DIR, ctx.stagingName);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const encoded = path.join(staging, 'out.mkv');

  await ctx.setStage('encoding');
  await run(FFMPEG, [
    '-y', '-v', 'error', ...HW_ARGS, '-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv', '-i', target,
    '-map', '0:v:0', '-map', '0:a', '-map_metadata', '0', '-map_chapters', '0',
    '-c:v', 'hevc_qsv', '-preset', ctx.preset, '-global_quality', String(ctx.quality), '-c:a', 'copy', encoded,
  ], { signal, nice: NICE });

  await ctx.setStage('validating');
  const after = await probe(encoded);
  const { size: originalBytes } = await stat(target);
  const { size: encodedBytes } = await stat(encoded);
  if (after.codec !== 'hevc' || Math.abs(after.duration - before.duration) > Math.max(10, before.duration * 0.01)) {
    throw new Error(`validation failed: re-encode came out ${after.codec}, ${after.duration}s of ${before.duration}s`);
  }
  if (!worthKeeping(originalBytes, encodedBytes)) {
    await rm(staging, { recursive: true, force: true });
    await ctx.note(`Kept the original: ${encodedBytes} bytes is not 10% under ${originalBytes}`);
    await prisma.twitchMediaFile.update({
      where: { id: file.id },
      data: { reencodeSkippedAt: new Date(), reencodeSkippedBytes: BigInt(encodedBytes) },
    });
    return;
  }

  // Same name, so Jellyfin keeps the item, its watched state and the resume point.
  await ctx.assertLease();
  await ctx.setStage('swapping');
  await mkdir(path.dirname(parked), { recursive: true });
  await rename(target, parked);
  try {
    await rename(encoded, target);
  } catch (error) {
    await rename(parked, target);
    throw error;
  }

  await recordSwap(ctx, file.id, parked, { sizeBytes: encodedBytes, originalBytes, originalCodec: before.codec });
  await rm(staging, { recursive: true, force: true });
}

async function recordSwap(
  ctx: { prisma: PrismaClient; job: TwitchJob; keepOriginalDays: number; quality: number },
  fileId: string,
  parked: string,
  sizes: { sizeBytes: number; originalBytes: number; originalCodec: string | null },
): Promise<void> {
  await ctx.prisma.twitchMediaFile.update({
    where: { id: fileId },
    data: {
      sizeBytes: BigInt(sizes.sizeBytes),
      videoCodec: 'hevc',
      reencodedAt: new Date(),
      reencodeQuality: ctx.quality,
      reencodeSkippedAt: null,
      reencodeSkippedBytes: null,
      originalRelativePath: path.relative(LIBRARY_DIR, parked),
      originalDeleteAfter: new Date(Date.now() + ctx.keepOriginalDays * 86_400_000),
      originalSizeBytes: BigInt(sizes.originalBytes),
      originalVideoCodec: sizes.originalCodec,
      originalDeletedAt: null,
    },
  });
  await ctx.prisma.twitchJob.update({ where: { id: ctx.job.id }, data: { needsJellyfinRefresh: true } });
}

/** Deletes originals past their date. Every removal is audited, by a system actor. */
export async function deleteExpiredOriginals(prisma: PrismaClient, now = new Date()): Promise<number> {
  const due = await prisma.twitchMediaFile.findMany({
    // A job on the file may be about to restore this very original.
    where: {
      originalRelativePath: { not: null },
      originalDeleteAfter: { lte: now },
      jobs: { none: { state: { in: ['QUEUED', 'BLOCKED', 'RUNNING', 'RETRY_WAIT'] } } },
    },
    include: { video: { select: { title: true, streamer: { select: { displayName: true } } } } },
  });
  for (const file of due) {
    const startedAt = new Date();
    let errorMessage: string | null = null;
    try {
      const original = path.join(LIBRARY_DIR, file.originalRelativePath!);
      const freedBytes = (await stat(original).catch(() => null))?.size ?? 0;
      await rm(original, { force: true });
      await prisma.twitchMediaFile.update({
        where: { id: file.id },
        data: { originalRelativePath: null, originalDeleteAfter: null, originalDeletedAt: now },
      });
      await recordDeletion(prisma, {
        videoId: file.videoId,
        title: file.video.title,
        streamer: file.video.streamer.displayName,
        kind: 'ORIGINAL',
        cause: 'KEEP_PERIOD',
        freedBytes,
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    await writeDeleteAudit(prisma, {
      title: file.video.title,
      fileCount: 1,
      details: { kind: 'original-after-reencode', relativePath: file.originalRelativePath },
      startedAt,
      errorMessage,
    });
  }
  return due.length;
}

/** The Library's own record. A failure here must not fail a delete that already happened. */
export async function recordDeletion(prisma: PrismaClient, input: {
  videoId: string;
  title: string;
  streamer: string;
  kind: TwitchDeletionKind;
  cause: TwitchDeletionCause;
  freedBytes: number;
  detail?: string | null;
  deletedBy?: string | null;
}): Promise<void> {
  try {
    await prisma.twitchDeletedFile.create({ data: { ...input, freedBytes: BigInt(input.freedBytes) } });
  } catch (error) {
    console.error('[TwitchWorker] Failed to record a deletion', error);
  }
}

// recordOperationAudit needs the app's request context, so the same row is written here.
export async function writeDeleteAudit(prisma: PrismaClient, input: {
  title: string;
  fileCount: number;
  details: Record<string, unknown>;
  startedAt: Date;
  errorMessage: string | null;
  actor?: { id: string | null; username: string };
}): Promise<void> {
  await prisma.fileOperationAudit.create({
    data: {
      userId: input.actor?.id ?? null,
      username: input.actor?.username ?? 'system:twitch-worker',
      service: 'TWITCH',
      operation: 'DELETE_MEDIA',
      mediaType: 'twitch-video',
      mediaTitle: input.title,
      fileCount: input.fileCount,
      filesDeleted: input.errorMessage === null,
      details: input.details as Prisma.InputJsonValue,
      success: input.errorMessage === null,
      errorMessage: input.errorMessage,
      startedAt: input.startedAt,
    },
  }).catch((error) => console.error('[TwitchWorker] Failed to write audit row', error));
}
