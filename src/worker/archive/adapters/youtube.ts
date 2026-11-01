import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CreatorVideoType, Prisma } from '@prisma/client';
import { archiveEpisode, localDate, safeFilenameTitle } from '@/lib/archive/naming';
import { seasonNfo } from '@/lib/archive/nfo';
import { parseProgressLine, YT_DLP_PROGRESS_TEMPLATE } from '@/lib/archive/progress';
import { decryptTwitchToken } from '@/lib/twitch/token-cipher';
import { vttToSrt } from '@/lib/youtube/captions';
import { formatSelector, selectedBytes, summarizeFormats } from '@/lib/youtube/formats';
import { youtubeEpisodeNfo, youtubeShowNfo } from '@/lib/youtube/nfo';
import type { DownloadContext, EpisodeLayout, PlatformAdapter, PreparedDownload, Sidecar } from '../adapter';
import { FFMPEG } from '../env';
import { nextSequentialEpisode } from '../episodes';
import { WaitForRecordingError } from '../pipeline';
import { run } from '../process';
import { toolPath } from '../tools';

const DB_PROGRESS_INTERVAL_MS = 5_000;
// When YouTube gives no sizes: its heaviest common case, so the disk guard errs on the safe side.
const FALLBACK_BYTES_PER_SECOND = 1_500_000;
const SHORTS_SEASON = 1;
const ARTWORK_HOSTS = new Set(['i.ytimg.com', 'yt3.ggpht.com', 'yt3.googleusercontent.com']);
const NFO_TYPES: Partial<Record<CreatorVideoType, 'video' | 'live' | 'short'>> = { UPLOAD: 'video', ARCHIVE: 'live', SHORT: 'short' };

// --ignore-config so nothing on the host changes a download. Deno is yt-dlp's only default
// runtime, and the worker has Node.
const BASE_ARGS = ['--ignore-config', '--no-playlist', '--js-runtimes', 'node'];

interface YoutubeInfo {
  live_status?: string;
  duration?: number;
  requested_formats?: Array<{ filesize?: number | null; filesize_approx?: number | null }>;
  chapters?: Array<{ start_time: number; title?: string }> | null;
}

interface YoutubePrepared extends PreparedDownload<YoutubeInfo> {
  selector: string;
}

const videoUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

/** What reads one video, shared with the tool smoke test. */
export const youtubeVideoArgs = (id: string) => [...BASE_ARGS, '-J', videoUrl(id)];

const cookieArgs = ({ cookiesFile }: DownloadContext) => (cookiesFile ? ['--cookies', cookiesFile] : []);

function sponsorblockArgs(mode: string | undefined): string[] {
  if (mode === 'remove') return ['--sponsorblock-mark', 'all', '--sponsorblock-remove', 'sponsor'];
  return mode === 'mark' ? ['--sponsorblock-mark', 'all'] : [];
}

const CAPTION_LANGUAGES = ['en', 'en-US', 'en-GB', 'en-orig'];

// Captions are a bonus, and a new video may have none yet. Asked for in a separate run so
// that a refused caption request can never fail the video.
async function saveCaptions(ctx: DownloadContext, staging: string): Promise<Sidecar[]> {
  const { video, signal } = ctx;
  try {
    await run(toolPath('ytdlpYoutube'), [
      ...BASE_ARGS, '--skip-download', '--write-subs', '--write-auto-subs',
      '--sub-langs', CAPTION_LANGUAGES.join(','), '--sub-format', 'vtt', ...cookieArgs(ctx),
      '-o', path.join(staging, 'captions.%(ext)s'),
      videoUrl(video.externalId),
    ], { signal });
    const files = await readdir(staging);
    const name = CAPTION_LANGUAGES.map((language) => `captions.${language}.vtt`).find((file) => files.includes(file));
    const srt = name ? vttToSrt(await readFile(path.join(staging, name), 'utf8')) : '';
    if (!srt) {
      await ctx.note('YouTube has no English captions for this video yet');
      return [];
    }
    const stagedPath = path.join(staging, 'captions.srt');
    await writeFile(stagedPath, srt);
    return [{ stagedPath, suffix: '.en.srt' }];
  } catch (error) {
    if (signal.aborted) throw error;
    await ctx.note(`Captions skipped: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`);
    return [];
  }
}

async function downloadVideo(ctx: DownloadContext, staging: string, selector: string): Promise<string> {
  const { prisma, job, video, signal, options } = ctx;
  let lastWrite = 0;
  await run(toolPath('ytdlpYoutube'), [
    ...BASE_ARGS, '--ffmpeg-location', FFMPEG, '-N', '6', '-f', selector, '--merge-output-format', 'mkv',
    ...(options.chapters ? ['--embed-chapters'] : []), ...sponsorblockArgs(options.sponsorblock), ...cookieArgs(ctx),
    '--write-info-json', '--newline', '--no-color', '--progress-template', YT_DLP_PROGRESS_TEMPLATE,
    '-o', path.join(staging, 'video.%(ext)s'),
    videoUrl(video.externalId),
  ], {
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
  const file = (await readdir(staging)).find((name) => name === 'video.mkv');
  if (!file) throw new Error('validation failed: the download left no video');
  return path.join(staging, file);
}

/** What a person sees in the sheet. Sizes only: no format link is ever stored. */
export async function readYoutubeFormats(ctx: Pick<DownloadContext, 'prisma' | 'video' | 'cookiesFile' | 'signal'>): Promise<void> {
  const { prisma, video, signal } = ctx;
  const info = JSON.parse(await run(toolPath('ytdlpYoutube'), [
    ...youtubeVideoArgs(video.externalId),
    ...(ctx.cookiesFile ? ['--cookies', ctx.cookiesFile] : []),
  ], { signal, captureStdout: true })) as { formats?: Parameters<typeof summarizeFormats>[0] };
  await prisma.creatorVideo.update({
    where: { id: video.id },
    data: { formats: summarizeFormats(info.formats ?? []) as unknown as Prisma.InputJsonValue, formatsCheckedAt: new Date() },
  });
}

export const youtubeAdapter: PlatformAdapter<YoutubeInfo> = {
  platform: 'YOUTUBE',

  isArtworkUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && ARTWORK_HOSTS.has(parsed.hostname) && !parsed.port;
    } catch {
      return false;
    }
  },

  // Only a video that needs it. Everything else runs with no cookies at all, which limits what
  // the account is exposed to. Each job gets its own copy, mode 600, gone when the job ends.
  async openSession(_settings, { prisma, video }) {
    const none = { cookiesFile: null, browserToken: null, release: async () => undefined };
    if (!video.ageRestricted) return none;
    const settings = await prisma.youtubeSettings.findUnique({ where: { id: 'singleton' }, select: { cookies: true, cookiesValid: true } });
    const cookies = decryptTwitchToken(settings?.cookies);
    if (!cookies || settings?.cookiesValid === false) return none;

    const dir = await mkdtemp(path.join(os.tmpdir(), 'youtube-cookies-'));
    const file = path.join(dir, 'cookies.txt');
    await writeFile(file, cookies, { mode: 0o600 });
    await chmod(file, 0o600);
    return {
      cookiesFile: file,
      browserToken: null,
      release: async () => {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      },
    };
  },

  async prepare(ctx) {
    const { video, options, signal } = ctx;
    if (video.availability === 'RECORDING') throw new WaitForRecordingError();
    // Stops here, before YouTube is asked: repeated failed logins could harm the account.
    if (video.ageRestricted && !ctx.cookiesFile) throw new Error('Sign in to confirm your age: no working account');
    const selector = formatSelector(options.quality, options.codec ?? 'compatible');
    const info = JSON.parse(await run(toolPath('ytdlpYoutube'), [...youtubeVideoArgs(video.externalId), ...cookieArgs(ctx), '-f', selector], {
      signal,
      captureStdout: true,
    })) as YoutubeInfo;
    if (info.live_status === 'is_live' || info.live_status === 'is_upcoming') throw new WaitForRecordingError();

    const duration = info.duration ?? video.durationSeconds;
    const prepared: YoutubePrepared = {
      info,
      selector,
      duration,
      audioOnly: false,
      expectedBytes: selectedBytes(info.requested_formats) ?? duration * FALLBACK_BYTES_PER_SECOND,
      mayBeShorter: options.sponsorblock === 'remove',
    };
    return prepared;
  },

  async download(ctx, staging, prepared) {
    return downloadVideo(ctx, staging, (prepared as YoutubePrepared).selector);
  },

  async extras(ctx, staging) {
    if (!ctx.options.captions) return [];
    await ctx.setStage('saving captions');
    return saveCaptions(ctx, staging);
  },

  async layout(ctx, prepared, duration): Promise<EpisodeLayout> {
    const { prisma, video } = ctx;
    const { creator: channel } = video;
    const date = video.sourceCreatedAt;
    const isShort = video.type === 'SHORT';
    const numbering = isShort ? await nextSequentialEpisode(prisma, video, SHORTS_SEASON, 'SHORT') : archiveEpisode(date);
    const season = String(numbering.season).padStart(2, '0');
    const episode = String(numbering.episode).padStart(2, '0');
    const seasonFolder = isShort ? 'Season 01 Shorts' : `Season ${numbering.season}`;
    const showName = safeFilenameTitle(channel.displayName);
    const { chapters } = prepared.info as YoutubeInfo;
    return {
      seriesFolder: channel.folderName,
      seasonFolder,
      baseName: `${showName} - S${season}E${episode} - ${localDate(date)} - ${safeFilenameTitle(video.title)} [${video.externalId}]`,
      tvshowNfo: youtubeShowNfo({ channelName: channel.displayName, login: channel.login, description: channel.description, channelId: channel.externalId }),
      seasonNfo: seasonNfo(isShort ? 'Shorts' : String(numbering.season), numbering.season),
      episodeNfo: youtubeEpisodeNfo({
        title: video.title,
        channelName: channel.displayName,
        season: numbering.season,
        episode: numbering.episode,
        date,
        addedAt: new Date(),
        durationSeconds: duration,
        description: video.description,
        type: NFO_TYPES[video.type] ?? 'video',
        videoId: video.externalId,
      }),
      artwork: [
        ['poster.jpg', channel.profileImageUrl],
        ['fanart.jpg', channel.offlineImageUrl],
      ],
      thumbnailUrl: video.thumbnailUrl,
      videoUpdate: chapters?.length
        ? { chapters: chapters.map(({ start_time, title }) => ({ start: Math.round(start_time), title: title ?? 'Chapter' })) }
        : {},
    };
  },
};
