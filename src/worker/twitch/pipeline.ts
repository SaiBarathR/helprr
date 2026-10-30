import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline as pipeStreams } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { PrismaClient, TwitchJob, TwitchStreamer, TwitchVideo } from '@prisma/client';
import { chapterGenres, chaptersToFfmetadata, sanitizeInfoJson, type YtDlpChapter } from '@/lib/twitch/chapters';
import { chatToAss, type ChatComment } from '@/lib/twitch/chat-ass';
import { archiveEpisode, episodeBaseName, seasonFolder, type SeasonKind } from '@/lib/twitch/naming';
import { episodeNfo, seasonNfo, tvshowNfo } from '@/lib/twitch/nfo';
import { parseProgressLine, YT_DLP_PROGRESS_TEMPLATE } from '@/lib/twitch/progress';
import { estimateSizeBytes, pickFormat, type YtDlpFormat } from '@/lib/twitch/quality';
import { classifyJobError } from '@/lib/twitch/job-errors';
import type { DownloadOptions } from '@/lib/twitch/jobs';
import { sizeThumbnail } from '@/lib/twitch/serialize';
import { FFMPEG, FFPROBE, LIBRARY_DIR, STAGING_DIR } from './env';
import { ProcessFailedError, run } from './process';
import { toolPath } from './tools';

const RECORDING_RECHECK_MS = 15 * 60_000;
const DB_PROGRESS_INTERVAL_MS = 5_000;
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

interface VideoInfo {
  live_status?: string;
  duration?: number;
  formats?: YtDlpFormat[];
  chapters?: YtDlpChapter[] | null;
}

interface JobContext {
  prisma: PrismaClient;
  job: TwitchJob;
  video: TwitchVideo & { streamer: TwitchStreamer };
  options: DownloadOptions;
  signal: AbortSignal;
  minFreeGb: number;
  reencodeEnabled: boolean;
  cookiesFile: string | null;
  browserToken: string | null;
  setStage: (stage: string) => Promise<void>;
  assertLease: () => Promise<void>;
  stagingName: string;
  note: (message: string) => Promise<void>;
}

function videoUrl(id: string): string {
  return `https://www.twitch.tv/videos/${id}`;
}

async function probe(file: string): Promise<{ videoCodec: string; height: number | null; duration: number; video: number; audio: number }> {
  const output = await run(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { captureStdout: true });
  const data = JSON.parse(output) as {
    streams: Array<{ codec_type: string; codec_name: string; height?: number }>;
    format: { duration?: string };
  };
  const videos = data.streams.filter((stream) => stream.codec_type === 'video');
  return {
    videoCodec: videos[0]?.codec_name ?? 'unknown',
    height: videos[0]?.height ?? null,
    duration: Number(data.format.duration ?? 0),
    video: videos.length,
    audio: data.streams.filter((stream) => stream.codec_type === 'audio').length,
  };
}

export function validateDuration(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= Math.max(10, expected * 0.01);
}

async function checkDisk(ctx: JobContext, duration: number): Promise<void> {
  const stats = await statfs(LIBRARY_DIR);
  const free = stats.bavail * stats.bsize;
  const needed = estimateSizeBytes(ctx.options.quality, duration) + ctx.minFreeGb * GIB;
  if (free < needed) throw new DiskGuardError();
}

async function downloadVideo(ctx: JobContext, staging: string, format: string): Promise<string> {
  const { prisma, job, video, signal, cookiesFile } = ctx;
  let lastWrite = 0;
  const args = [
    '--no-playlist', '--ffmpeg-location', FFMPEG, '-N', '6', '-f', format, '--newline', '--no-color',
    '--progress-template', YT_DLP_PROGRESS_TEMPLATE,
    '--write-info-json',
    '-o', path.join(staging, 'video.%(ext)s'),
    ...(cookiesFile ? ['--cookies', cookiesFile] : []),
    videoUrl(video.twitchVideoId),
  ];
  try {
    await run(toolPath('ytdlp'), args, {
      signal,
      onLine: (line) => {
        const progress = parseProgressLine(line);
        if (!progress || Date.now() - lastWrite < DB_PROGRESS_INTERVAL_MS) return;
        lastWrite = Date.now();
        void prisma.twitchJob.update({
          where: { id: job.id },
          data: {
            progress: progress.totalBytes ? Math.min(1, (progress.downloadedBytes ?? 0) / progress.totalBytes) : null,
            bytesDone: progress.downloadedBytes === null ? null : BigInt(Math.round(progress.downloadedBytes)),
            bytesTotal: progress.totalBytes === null ? null : BigInt(Math.round(progress.totalBytes)),
            speedBps: progress.speed,
            etaSeconds: progress.etaSeconds === null ? null : Math.round(progress.etaSeconds),
          },
        }).catch(() => undefined);
      },
    });
  } catch (error) {
    if (!(error instanceof ProcessFailedError)) throw error;
    await ctx.setStage('downloading (fallback)');
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    await run(toolPath('td'), [
      'videodownload', '-u', video.twitchVideoId, '-q', format, '--threads', '6', '--ffmpeg-path', FFMPEG,
      '--temp-path', path.join(staging, 'cache'), '--collision', 'Exit', '--banner', 'false',
      '-o', path.join(staging, 'video.mp4'),
      // Its only way in. This stays inside the container, and arguments are never logged.
      ...(ctx.browserToken ? ['--oauth', ctx.browserToken] : []),
    ], { signal, env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' } });
  }
  const file = (await readdir(staging)).find((name) => name.startsWith('video.') && !name.endsWith('.info.json'));
  if (!file) throw new Error('validation failed: the download left no video');
  return path.join(staging, file);
}

interface ChatFiles {
  json: string;
  ass: string;
}

// Chat is a bonus: a VOD is not lost because its chat could not be fetched.
async function archiveChat(ctx: JobContext, staging: string): Promise<ChatFiles | null> {
  const { video, signal } = ctx;
  const json = path.join(staging, 'chat.json');
  try {
    await run(toolPath('td'), ['chatdownload', '--id', video.twitchVideoId, '-o', json, '--banner', 'false'], {
      signal,
      env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' },
    });
    const { comments } = JSON.parse(await readFile(json, 'utf8')) as { comments: ChatComment[] };
    const { ass, thinned } = chatToAss(comments);
    if (thinned) await ctx.note(`Chat thinned to fit the subtitle size limit (${comments.length} messages)`);

    const assFile = path.join(staging, 'chat.ass');
    await writeFile(assFile, ass);
    const gzipFile = `${json}.gz`;
    await pipeStreams(createReadStream(json), createGzip(), createWriteStream(gzipFile));
    await rm(json);
    return { json: gzipFile, ass: assFile };
  } catch (error) {
    if (signal.aborted) throw error;
    await ctx.note(`Chat archive skipped: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`);
    return null;
  }
}

async function publish(ctx: JobContext, staging: string, mkv: string, info: VideoInfo, duration: number, probed: Awaited<ReturnType<typeof probe>>, chat: ChatFiles | null) {
  const { prisma, video, job, options } = ctx;
  const { streamer } = video;
  const date = video.twitchCreatedAt;
  const kind = video.type as SeasonKind;
  const numbering = kind === 'ARCHIVE'
    ? archiveEpisode(date)
    : await assignSequentialEpisode(prisma, video, kind);

  const seriesDir = path.join(LIBRARY_DIR, streamer.folderName);
  const seasonDir = path.join(seriesDir, seasonFolder(kind, numbering.season));
  await mkdir(seasonDir, { recursive: true });

  const base = episodeBaseName({
    folderName: streamer.folderName,
    season: numbering.season,
    episode: numbering.episode,
    date,
    title: video.title,
    twitchVideoId: video.twitchVideoId,
  });

  await writeFile(path.join(seriesDir, 'tvshow.nfo'), tvshowNfo({
    displayName: streamer.displayName,
    login: streamer.login,
    description: streamer.description,
    broadcasterType: streamer.broadcasterType,
    twitchUserId: streamer.twitchUserId,
  }));
  await writeArt(streamer, seriesDir, ctx.signal);

  const seasonTitle = kind === 'ARCHIVE' ? String(numbering.season) : kind === 'HIGHLIGHT' ? 'Highlights' : 'Uploads';
  await writeFile(path.join(seasonDir, 'season.nfo'), seasonNfo(seasonTitle, numbering.season));

  const sidecars: string[] = [];
  const nfoFile = `${base}.nfo`;
  await writeFile(path.join(staging, nfoFile), episodeNfo({
    title: video.title,
    displayName: streamer.displayName,
    season: numbering.season,
    episode: numbering.episode,
    date,
    addedAt: new Date(),
    durationSeconds: duration,
    description: video.description,
    type: kind.toLowerCase() as 'archive' | 'highlight' | 'upload',
    genres: chapterGenres(info.chapters ?? []),
    twitchVideoId: video.twitchVideoId,
  }));
  sidecars.push(nfoFile);
  const infoJson = path.join(staging, 'video.info.json');
  if (await stat(infoJson).catch(() => null)) {
    const infoName = `${base}.info.json`;
    await writeFile(path.join(staging, infoName), sanitizeInfoJson(await readFile(infoJson, 'utf8')));
    sidecars.push(infoName);
  }
  const thumbName = `${base}-thumb.jpg`;
  if (await fetchThumbnail(video.thumbnailUrl, path.join(staging, thumbName), ctx.signal)) sidecars.push(thumbName);
  if (chat) {
    const assName = `${base}.en.chat.ass`;
    const jsonName = `${base}.chat.json.gz`;
    await rename(chat.ass, path.join(staging, assName));
    await rename(chat.json, path.join(staging, jsonName));
    sidecars.push(assName, jsonName);
  }

  // Artwork can take a while, so the lease is checked again right before the library changes.
  await ctx.assertLease();
  // Sidecars first and the video last, so Jellyfin never indexes a half-written set.
  for (const name of sidecars) await rename(path.join(staging, name), path.join(seasonDir, name));
  const videoName = `${base}.mkv`;
  await rename(mkv, path.join(seasonDir, videoName));

  const relativePath = path.relative(LIBRARY_DIR, path.join(seasonDir, videoName));
  const { size } = await stat(path.join(seasonDir, videoName));
  await prisma.twitchMediaFile.upsert({
    where: { relativePath },
    update: { sizeBytes: BigInt(size), durationSeconds: Math.round(duration), videoCodec: probed.videoCodec, height: probed.height, keepForever: options.keepForever },
    create: {
      videoId: video.id,
      relativePath,
      sidecars: sidecars.map((name) => path.relative(LIBRARY_DIR, path.join(seasonDir, name))),
      sizeBytes: BigInt(size),
      durationSeconds: Math.round(duration),
      videoCodec: probed.videoCodec,
      height: probed.height,
      keepForever: options.keepForever,
    },
  });
  await prisma.twitchJob.update({ where: { id: job.id }, data: { needsJellyfinRefresh: true } });
  const firstGame = chapterGenres(info.chapters ?? [])[0];
  await prisma.twitchVideo.update({
    where: { id: video.id },
    data: {
      ...(firstGame && !video.category ? { category: firstGame } : {}),
      ...(info.chapters?.length
        ? { chapters: info.chapters.map(({ start_time, title }) => ({ start: Math.round(start_time), title: title ?? 'Stream' })) }
        : {}),
    },
  });

  if (options.reencode && ctx.reencodeEnabled && probed.videoCodec === 'h264') {
    const { id: mediaFileId } = await prisma.twitchMediaFile.findUniqueOrThrow({ where: { relativePath }, select: { id: true } });
    await prisma.twitchJob.create({
      data: { kind: 'REENCODE', videoId: video.id, mediaFileId, source: job.source, requestedByUserId: job.requestedByUserId, requestedByUsername: job.requestedByUsername },
    });
  }
}

// Jellyfin's art comes from the same files every time, so they are only ever fetched once.
async function writeArt(streamer: TwitchStreamer, seriesDir: string, signal: AbortSignal): Promise<void> {
  const targets: Array<[string, string | null]> = [
    ['poster.jpg', streamer.profileImageUrl],
    ['fanart.jpg', streamer.offlineImageUrl],
    ['landscape.jpg', streamer.offlineImageUrl],
  ];
  for (const [name, url] of targets) {
    const file = path.join(seriesDir, name);
    if (!url || (await stat(file).catch(() => null))) continue;
    const res = await fetch(url, { signal });
    if (!res.ok) continue;
    if (name !== 'poster.jpg') {
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      continue;
    }
    // Profile images are square and a poster is 2:3, so it is padded rather than cropped.
    const square = `${file}.source`;
    await writeFile(square, Buffer.from(await res.arrayBuffer()));
    await run(FFMPEG, ['-y', '-v', 'error', '-f', 'image2pipe', '-i', square, '-vf', 'pad=iw:iw*3/2:0:(oh-ih)/2:black', '-frames:v', '1', '-update', '1', file], { signal });
    await rm(square);
  }
}

// Missing art is cosmetic, so it never costs the video.
async function fetchThumbnail(url: string | null, file: string, signal: AbortSignal): Promise<boolean> {
  const sized = sizeThumbnail(url, 1280, 720);
  if (!sized) return false;
  const res = await fetch(sized, { signal }).catch(() => null);
  if (!res?.ok) return false;
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return true;
}

async function assignSequentialEpisode(prisma: PrismaClient, video: TwitchVideo, kind: SeasonKind) {
  const season = kind === 'HIGHLIGHT' ? 1 : 2;
  if (video.seasonEpisode !== null) return { season, episode: video.seasonEpisode };
  const episode = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`twitch-season:${video.streamerId}:${kind}`}))`;
    const { _max } = await tx.twitchVideo.aggregate({
      where: { streamerId: video.streamerId, type: video.type },
      _max: { seasonEpisode: true },
    });
    const next = (_max.seasonEpisode ?? 0) + 1;
    await tx.twitchVideo.update({ where: { id: video.id }, data: { seasonEpisode: next } });
    return next;
  });
  return { season, episode };
}

export async function runDownload(ctx: JobContext): Promise<void> {
  const { video, options, signal, cookiesFile } = ctx;
  const staging = path.join(STAGING_DIR, ctx.stagingName);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  await ctx.setStage('reading metadata');
  let info: VideoInfo = {};
  try {
    const json = await run(toolPath('ytdlp'), [
      '-J', '--no-playlist', ...(cookiesFile ? ['--cookies', cookiesFile] : []), videoUrl(video.twitchVideoId),
    ], { signal, captureStdout: true });
    info = JSON.parse(json) as VideoInfo;
  } catch (error) {
    // Only a broken extractor: the fallback tool can still fetch by id, without chapters.
    if (!(error instanceof ProcessFailedError) || classifyJobError(error.message) !== 'extractor') throw error;
    await ctx.note('yt-dlp could not read the video, so trying the fallback tool');
  }
  if (info.live_status === 'is_live') throw new WaitForRecordingError();

  const format = info.formats ? pickFormat(info.formats, options.quality) : options.quality;
  if (!format) throw new Error('validation failed: no video formats');
  const audioOnly = format.toLowerCase().startsWith('audio');
  const duration = info.duration ?? video.durationSeconds;
  await checkDisk(ctx, duration);

  await ctx.setStage('downloading');
  const source = await downloadVideo(ctx, staging, format);

  await ctx.setStage('remuxing');
  const mkv = path.join(staging, 'out.mkv');
  const chapters = options.chapters ? chaptersToFfmetadata(info.chapters ?? [], duration) : null;
  const metaFile = path.join(staging, 'chapters.ffmeta');
  if (chapters) await writeFile(metaFile, chapters);
  await run(FFMPEG, [
    '-y', '-v', 'error', '-i', source,
    ...(chapters ? ['-i', metaFile, '-map_chapters', '1'] : []),
    // Explicit maps: the fallback tool's bin_data stream breaks a plain -map 0.
    ...(audioOnly ? ['-map', '0:a:0'] : ['-map', '0:v:0', '-map', '0:a:0?']), '-map_metadata', '0', '-c', 'copy', mkv,
  ], { signal });

  await ctx.setStage('validating');
  const probed = await probe(mkv);
  if (probed.video !== (audioOnly ? 0 : 1) || probed.audio !== 1) throw new Error('validation failed: unexpected streams');
  if (!validateDuration(probed.duration, duration)) throw new Error(`validation failed: duration mismatch ${probed.duration} vs ${duration}`);

  let chat: ChatFiles | null = null;
  if (options.chat) {
    await ctx.setStage('archiving chat');
    chat = await archiveChat(ctx, staging);
  }

  await ctx.assertLease();
  await ctx.setStage('publishing');
  await publish(ctx, staging, mkv, info, probed.duration, probed, chat);
  await rm(staging, { recursive: true, force: true });
}

