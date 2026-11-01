import { mkdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeInfoJson } from '@/lib/twitch/chapters';
import type { DownloadContext, EpisodeLayout, PlatformAdapter, Sidecar } from './adapter';
import { FFMPEG, FFPROBE, libraryFor } from './env';
import { run } from './process';

// Sponsor cuts remove minutes, not most of a video.
const MIN_SHARE_AFTER_CUTS = 0.5;
const RECORDING_RECHECK_MS = 15 * 60_000;
const GIB = 1024 ** 3;

export class WaitForRecordingError extends Error {
  readonly runAfter = new Date(Date.now() + RECORDING_RECHECK_MS);
}

export class DiskGuardError extends Error {
  constructor() {
    super('Not enough free disk space');
    this.name = 'DiskGuardError';
  }
}

async function probe(file: string): Promise<{ videoCodec: string; width: number | null; height: number | null; duration: number; video: number; audio: number }> {
  const output = await run(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { captureStdout: true });
  const data = JSON.parse(output) as {
    streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number }>;
    format: { duration?: string };
  };
  const videos = data.streams.filter((stream) => stream.codec_type === 'video');
  return {
    videoCodec: videos[0]?.codec_name ?? 'unknown',
    width: videos[0]?.width ?? null,
    height: videos[0]?.height ?? null,
    duration: Number(data.format.duration ?? 0),
    video: videos.length,
    audio: data.streams.filter((stream) => stream.codec_type === 'audio').length,
  };
}

export function validateDuration(actual: number, expected: number, mayBeShorter = false): boolean {
  const tolerance = Math.max(10, expected * 0.01);
  if (mayBeShorter) return actual <= expected + tolerance && actual >= expected * MIN_SHARE_AFTER_CUTS;
  return Math.abs(actual - expected) <= tolerance;
}

async function checkDisk(ctx: DownloadContext, expectedBytes: number): Promise<void> {
  const stats = await statfs(libraryFor(ctx.video.platform).root);
  const free = stats.bavail * stats.bsize;
  if (free < expectedBytes + ctx.minFreeGb * GIB) throw new DiskGuardError();
}

// Stored URLs come from an outside service, so the host is checked and a redirect, which
// could lead anywhere, is refused. A cancelled job still throws, to stop the publish.
async function fetchArtwork(adapter: PlatformAdapter, url: string, signal: AbortSignal): Promise<Buffer | null> {
  if (!adapter.isArtworkUrl(url)) return null;
  try {
    const res = await fetch(url, { signal, redirect: 'error' });
    if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}

// Jellyfin's art comes from the same files every time, so they are only ever fetched once.
async function writeArt(adapter: PlatformAdapter, artwork: EpisodeLayout['artwork'], seriesDir: string, signal: AbortSignal): Promise<void> {
  for (const [name, url] of artwork) {
    const file = path.join(seriesDir, name);
    if (!url || (await stat(file).catch(() => null))) continue;
    const image = await fetchArtwork(adapter, url, signal);
    if (!image) continue;
    if (name !== 'poster.jpg') {
      await writeFile(file, image);
      continue;
    }
    // Profile images are square and a poster is 2:3, so it is padded rather than cropped.
    const square = `${file}.source`;
    await writeFile(square, image);
    await run(FFMPEG, ['-y', '-v', 'error', '-f', 'image2pipe', '-i', square, '-vf', 'pad=iw:iw*3/2:0:(oh-ih)/2:black', '-frames:v', '1', '-update', '1', file], { signal });
    await rm(square);
  }
}

// Missing art is cosmetic, so it never costs the video.
async function fetchThumbnail(adapter: PlatformAdapter, url: string | null, file: string, signal: AbortSignal): Promise<boolean> {
  if (!url) return false;
  const image = await fetchArtwork(adapter, url, signal);
  if (!image) return false;
  await writeFile(file, image);
  return true;
}

async function publish(
  ctx: DownloadContext,
  adapter: PlatformAdapter,
  staging: string,
  mkv: string,
  layout: EpisodeLayout,
  probed: Awaited<ReturnType<typeof probe>>,
  extras: Sidecar[],
) {
  const { prisma, video, job, options } = ctx;
  const { root } = libraryFor(video.platform);
  const seriesDir = path.join(root, layout.seriesFolder);
  const seasonDir = path.join(seriesDir, layout.seasonFolder);
  await mkdir(seasonDir, { recursive: true });

  const { baseName: base } = layout;
  await writeFile(path.join(seriesDir, 'tvshow.nfo'), layout.tvshowNfo);
  await writeArt(adapter, layout.artwork, seriesDir, ctx.signal);
  await writeFile(path.join(seasonDir, 'season.nfo'), layout.seasonNfo);

  const sidecars: string[] = [];
  const nfoFile = `${base}.nfo`;
  await writeFile(path.join(staging, nfoFile), layout.episodeNfo);
  sidecars.push(nfoFile);
  const infoJson = path.join(staging, 'video.info.json');
  if (await stat(infoJson).catch(() => null)) {
    const infoName = `${base}.info.json`;
    await writeFile(path.join(staging, infoName), sanitizeInfoJson(await readFile(infoJson, 'utf8')));
    sidecars.push(infoName);
  }
  const thumbName = `${base}-thumb.jpg`;
  if (await fetchThumbnail(adapter, layout.thumbnailUrl, path.join(staging, thumbName), ctx.signal)) sidecars.push(thumbName);
  for (const { stagedPath, suffix } of extras) {
    const name = `${base}${suffix}`;
    await rename(stagedPath, path.join(staging, name));
    sidecars.push(name);
  }

  // Artwork can take a while, so the lease is checked again right before the library changes.
  await ctx.assertLease();
  // Sidecars first and the video last, so Jellyfin never indexes a half-written set.
  for (const name of sidecars) await rename(path.join(staging, name), path.join(seasonDir, name));
  const videoName = `${base}.mkv`;
  await rename(mkv, path.join(seasonDir, videoName));

  const relativePath = path.relative(root, path.join(seasonDir, videoName));
  const { size } = await stat(path.join(seasonDir, videoName));
  await prisma.archiveMediaFile.upsert({
    where: { platform_relativePath: { platform: video.platform, relativePath } },
    update: { sizeBytes: BigInt(size), durationSeconds: Math.round(probed.duration), videoCodec: probed.videoCodec, height: probed.height, keepForever: options.keepForever },
    create: {
      platform: video.platform,
      videoId: video.id,
      relativePath,
      sidecars: sidecars.map((name) => path.relative(root, path.join(seasonDir, name))),
      sizeBytes: BigInt(size),
      durationSeconds: Math.round(probed.duration),
      videoCodec: probed.videoCodec,
      width: probed.width,
      height: probed.height,
      keepForever: options.keepForever,
    },
  });
  await prisma.archiveJob.update({ where: { id: job.id }, data: { needsJellyfinRefresh: true } });
  await prisma.creatorVideo.update({ where: { id: video.id }, data: layout.videoUpdate });

  // Twitch sends H.264 only. YouTube can arrive as AV1 or VP9, and nobody asks for this by accident.
  const convertible = probed.videoCodec === 'h264' || (ctx.video.platform === 'YOUTUBE' && probed.videoCodec !== 'hevc');
  if (options.reencode && ctx.reencodeEnabled && convertible) {
    const { id: mediaFileId } = await prisma.archiveMediaFile.findUniqueOrThrow({
      where: { platform_relativePath: { platform: video.platform, relativePath } },
      select: { id: true },
    });
    await prisma.archiveJob.create({
      data: { platform: video.platform, kind: 'REENCODE', videoId: video.id, mediaFileId, source: job.source, requestedByUserId: job.requestedByUserId, requestedByUsername: job.requestedByUsername },
    });
  }
}

export async function runDownload(ctx: DownloadContext, adapter: PlatformAdapter): Promise<void> {
  const staging = path.join(libraryFor(ctx.video.platform).staging, ctx.stagingName);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  await ctx.setStage('reading metadata');
  const prepared = await adapter.prepare(ctx);
  await checkDisk(ctx, prepared.expectedBytes);

  await ctx.setStage('downloading');
  const mkv = await adapter.download(ctx, staging, prepared);

  await ctx.setStage('validating');
  const probed = await probe(mkv);
  if (probed.video !== (prepared.audioOnly ? 0 : 1) || probed.audio !== 1) throw new Error('validation failed: unexpected streams');
  if (!validateDuration(probed.duration, prepared.duration, prepared.mayBeShorter)) throw new Error(`validation failed: duration mismatch ${probed.duration} vs ${prepared.duration}`);

  const extras = await adapter.extras(ctx, staging);

  await ctx.assertLease();
  await ctx.setStage('publishing');
  const layout = await adapter.layout(ctx, prepared, probed.duration);
  await publish(ctx, adapter, staging, mkv, layout, probed, extras);
  await rm(staging, { recursive: true, force: true });
}
