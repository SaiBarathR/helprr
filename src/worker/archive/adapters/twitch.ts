import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline as pipeStreams } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { PrismaClient, CreatorVideo } from '@prisma/client';
import { chapterGenres, chaptersToFfmetadata, type YtDlpChapter } from '@/lib/twitch/chapters';
import { chatToAss, type ChatComment } from '@/lib/twitch/chat-ass';
import { classifyJobError } from '@/lib/archive/job-errors';
import { archiveEpisode, episodeBaseName, seasonFolder, type SeasonKind } from '@/lib/twitch/naming';
import { episodeNfo, seasonNfo, tvshowNfo } from '@/lib/twitch/nfo';
import { parseProgressLine, YT_DLP_PROGRESS_TEMPLATE } from '@/lib/archive/progress';
import { estimateSizeBytes, pickFormat, type YtDlpFormat } from '@/lib/twitch/quality';
import { isTwitchArtworkUrl, sizeThumbnail } from '@/lib/twitch/serialize';
import { decryptTwitchToken } from '@/lib/twitch/token-cipher';
import type { DownloadContext, EpisodeLayout, PlatformAdapter, PreparedDownload, Sidecar } from '../adapter';
import { FFMPEG } from '../env';
import { WaitForRecordingError } from '../pipeline';
import { ProcessFailedError, run } from '../process';
import { toolPath } from '../tools';

const DB_PROGRESS_INTERVAL_MS = 5_000;

interface TwitchInfo {
  live_status?: string;
  duration?: number;
  formats?: YtDlpFormat[];
  chapters?: YtDlpChapter[] | null;
}

interface TwitchPrepared extends PreparedDownload<TwitchInfo> {
  format: string;
}

function videoUrl(id: string): string {
  return `https://www.twitch.tv/videos/${id}`;
}

// Tokens go in a mode-600 file per job, never argv, and it is removed with the job.
async function writeCookies(token: string | null): Promise<{ file: string; dir: string } | null> {
  if (!token) return null;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-cookies-'));
  const file = path.join(dir, 'cookies.txt');
  await writeFile(file, `# Netscape HTTP Cookie File\n.twitch.tv\tTRUE\t/\tTRUE\t0\tauth-token\t${token}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  return { file, dir };
}

async function downloadVideo(ctx: DownloadContext, staging: string, format: string): Promise<string> {
  const { prisma, job, video, signal, cookiesFile } = ctx;
  let lastWrite = 0;
  const args = [
    '--no-playlist', '--ffmpeg-location', FFMPEG, '-N', '6', '-f', format, '--newline', '--no-color',
    '--progress-template', YT_DLP_PROGRESS_TEMPLATE,
    '--write-info-json',
    '-o', path.join(staging, 'video.%(ext)s'),
    ...(cookiesFile ? ['--cookies', cookiesFile] : []),
    videoUrl(video.externalId),
  ];
  try {
    await run(toolPath('ytdlp'), args, {
      signal,
      onLine: (line) => {
        const progress = parseProgressLine(line);
        if (!progress || Date.now() - lastWrite < DB_PROGRESS_INTERVAL_MS) return;
        lastWrite = Date.now();
        void prisma.archiveJob.update({
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
      'videodownload', '-u', video.externalId, '-q', format, '--threads', '6', '--ffmpeg-path', FFMPEG,
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

// Chat is a bonus: a VOD is not lost because its chat could not be fetched.
async function archiveChat(ctx: DownloadContext, staging: string): Promise<Sidecar[]> {
  const { video, signal } = ctx;
  const json = path.join(staging, 'chat.json');
  try {
    await run(toolPath('td'), ['chatdownload', '--id', video.externalId, '-o', json, '--banner', 'false'], {
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
    return [{ stagedPath: assFile, suffix: '.en.chat.ass' }, { stagedPath: gzipFile, suffix: '.chat.json.gz' }];
  } catch (error) {
    if (signal.aborted) throw error;
    await ctx.note(`Chat archive skipped: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`);
    return [];
  }
}

async function assignSequentialEpisode(prisma: PrismaClient, video: CreatorVideo, kind: SeasonKind) {
  const season = kind === 'HIGHLIGHT' ? 1 : 2;
  if (video.seasonEpisode !== null) return { season, episode: video.seasonEpisode };
  const episode = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`twitch-season:${video.creatorId}:${kind}`}))`;
    const { _max } = await tx.creatorVideo.aggregate({
      where: { creatorId: video.creatorId, type: video.type },
      _max: { seasonEpisode: true },
    });
    const next = (_max.seasonEpisode ?? 0) + 1;
    await tx.creatorVideo.update({ where: { id: video.id }, data: { seasonEpisode: next } });
    return next;
  });
  return { season, episode };
}

export const twitchAdapter: PlatformAdapter<TwitchInfo> = {
  platform: 'TWITCH',
  isArtworkUrl: isTwitchArtworkUrl,

  async openSession(settings) {
    const browserToken = decryptTwitchToken(settings?.browserAuthToken);
    const cookies = await writeCookies(browserToken);
    return {
      cookiesFile: cookies?.file ?? null,
      browserToken,
      release: async () => {
        if (cookies) await rm(cookies.dir, { recursive: true, force: true }).catch(() => undefined);
      },
    };
  },

  async prepare(ctx) {
    const { video, options, signal, cookiesFile } = ctx;
    let info: TwitchInfo = {};
    try {
      const json = await run(toolPath('ytdlp'), [
        '-J', '--no-playlist', ...(cookiesFile ? ['--cookies', cookiesFile] : []), videoUrl(video.externalId),
      ], { signal, captureStdout: true });
      info = JSON.parse(json) as TwitchInfo;
    } catch (error) {
      // Only a broken extractor: the fallback tool can still fetch by id, without chapters.
      if (!(error instanceof ProcessFailedError) || classifyJobError(error.message) !== 'extractor') throw error;
      await ctx.note('yt-dlp could not read the video, so trying the fallback tool');
    }
    if (info.live_status === 'is_live') throw new WaitForRecordingError();

    const format = info.formats ? pickFormat(info.formats, options.quality) : options.quality;
    if (!format) throw new Error('validation failed: no video formats');
    const duration = info.duration ?? video.durationSeconds;
    const prepared: TwitchPrepared = {
      info,
      duration,
      format,
      audioOnly: format.toLowerCase().startsWith('audio'),
      expectedBytes: estimateSizeBytes(options.quality, duration),
    };
    return prepared;
  },

  async download(ctx, staging, prepared) {
    const { format, info, duration, audioOnly } = prepared as TwitchPrepared;
    const source = await downloadVideo(ctx, staging, format);

    await ctx.setStage('remuxing');
    const mkv = path.join(staging, 'out.mkv');
    const chapters = ctx.options.chapters ? chaptersToFfmetadata(info.chapters ?? [], duration) : null;
    const metaFile = path.join(staging, 'chapters.ffmeta');
    if (chapters) await writeFile(metaFile, chapters);
    await run(FFMPEG, [
      '-y', '-v', 'error', '-i', source,
      ...(chapters ? ['-i', metaFile, '-map_chapters', '1'] : []),
      // Explicit maps: the fallback tool's bin_data stream breaks a plain -map 0.
      ...(audioOnly ? ['-map', '0:a:0'] : ['-map', '0:v:0', '-map', '0:a:0?']), '-map_metadata', '0', '-c', 'copy', mkv,
    ], { signal: ctx.signal });
    return mkv;
  },

  async extras(ctx, staging) {
    if (!ctx.options.chat) return [];
    await ctx.setStage('archiving chat');
    return archiveChat(ctx, staging);
  },

  async layout(ctx, prepared, duration): Promise<EpisodeLayout> {
    const { prisma, video } = ctx;
    const { creator: streamer } = video;
    const { info } = prepared;
    const date = video.sourceCreatedAt;
    const kind = video.type as SeasonKind;
    const numbering = kind === 'ARCHIVE'
      ? archiveEpisode(date)
      : await assignSequentialEpisode(prisma, video, kind);
    const genres = chapterGenres(info.chapters ?? []);
    const seasonTitle = kind === 'ARCHIVE' ? String(numbering.season) : kind === 'HIGHLIGHT' ? 'Highlights' : 'Uploads';
    return {
      seriesFolder: streamer.folderName,
      seasonFolder: seasonFolder(kind, numbering.season),
      baseName: episodeBaseName({
        folderName: streamer.folderName,
        season: numbering.season,
        episode: numbering.episode,
        date,
        title: video.title,
        twitchVideoId: video.externalId,
      }),
      tvshowNfo: tvshowNfo({
        displayName: streamer.displayName,
        login: streamer.login,
        description: streamer.description,
        broadcasterType: streamer.broadcasterType,
        twitchUserId: streamer.externalId,
      }),
      seasonNfo: seasonNfo(seasonTitle, numbering.season),
      episodeNfo: episodeNfo({
        title: video.title,
        displayName: streamer.displayName,
        season: numbering.season,
        episode: numbering.episode,
        date,
        addedAt: new Date(),
        durationSeconds: duration,
        description: video.description,
        type: kind.toLowerCase() as 'archive' | 'highlight' | 'upload',
        genres,
        twitchVideoId: video.externalId,
      }),
      artwork: [
        ['poster.jpg', streamer.profileImageUrl],
        ['fanart.jpg', streamer.offlineImageUrl],
        ['landscape.jpg', streamer.offlineImageUrl],
      ],
      thumbnailUrl: sizeThumbnail(video.thumbnailUrl, 1280, 720),
      videoUpdate: {
        ...(genres[0] && !video.category ? { category: genres[0] } : {}),
        ...(info.chapters?.length
          ? { chapters: info.chapters.map(({ start_time, title }) => ({ start: Math.round(start_time), title: title ?? 'Stream' })) }
          : {}),
      },
    };
  },
};
