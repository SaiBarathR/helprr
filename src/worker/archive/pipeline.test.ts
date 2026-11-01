import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const paths = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/helprr-pipeline-${process.pid}-${Date.now()}`;
  return { library: dir, staging: `${dir}/.staging` };
});
const mocks = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('./env', () => ({
  LIBRARY_DIR: paths.library,
  STAGING_DIR: paths.staging,
  ORIGINALS_DIR: `${paths.library}/.originals`,
  FFMPEG: '/ffmpeg',
  FFPROBE: '/ffprobe',
  TOOLS_DIR: '/tools',
  WORKER_VERSION: 'test',
}));
vi.mock('./tools', () => ({ toolPath: (tool: string) => `/tools/${tool}` }));
vi.mock('./process', async (original) => ({ ...await original<typeof import('./process')>(), run: mocks.run }));

import { twitchAdapter } from './adapters/twitch';
import { DiskGuardError, runDownload as runPipeline, validateDuration, WaitForRecordingError } from './pipeline';
import { ProcessFailedError } from './process';

const runDownload = (ctx: Parameters<typeof runPipeline>[0]) => runPipeline(ctx, twitchAdapter);

const created = new Date(2026, 9, 30, 10, 0);
const streamer = {
  id: 's1', platform: 'TWITCH', externalId: '77', login: 'gigguk', folderName: 'gigguk', displayName: 'Gigguk',
  description: 'Anime', broadcasterType: 'partner', profileImageUrl: 'https://static-cdn.jtvnw.net/avatar.png',
  offlineImageUrl: 'https://static-cdn.jtvnw.net/banner.png',
};
const video = {
  id: 'v1', platform: 'TWITCH', externalId: '123', creatorId: 's1', type: 'ARCHIVE', title: 'A stream: part 1',
  description: 'About anime', sourceCreatedAt: created, durationSeconds: 120, category: null, seasonEpisode: null,
  thumbnailUrl: 'https://static-cdn.jtvnw.net/thumb-%{width}x%{height}.jpg', creator: streamer,
};
const options = { quality: '1080p60', chat: true, chapters: true, reencode: true, keepForever: false };
const info = {
  live_status: 'was_live',
  duration: 120,
  formats: [{ format_id: '1080p60', height: 1080, fps: 60, vcodec: 'h264', acodec: 'aac' }],
  chapters: [{ start_time: 0, end_time: 120, title: 'Elden Ring' }],
};

function fakeTools(overrides: { download?: () => never; metadata?: unknown; metadataFails?: string } = {}) {
  mocks.run.mockImplementation(async (command: string, args: string[]) => {
    if (command === '/tools/ytdlp' && args.includes('-J')) {
      if (overrides.metadataFails) throw new ProcessFailedError('yt-dlp', 1, overrides.metadataFails);
      return JSON.stringify(overrides.metadata ?? info);
    }
    if (command === '/tools/ytdlp') {
      overrides.download?.();
      const output = args[args.indexOf('-o') + 1];
      await writeFile(output.replace('%(ext)s', 'mp4'), 'video');
      await writeFile(output.replace('%(ext)s', 'info.json'), JSON.stringify({ id: '123', url: 'https://signed' }));
      return '';
    }
    if (command === '/tools/td' && args[0] === 'videodownload') {
      await writeFile(args[args.indexOf('-o') + 1], 'video');
      return '';
    }
    if (command === '/tools/td') {
      await writeFile(args[args.indexOf('-o') + 1], JSON.stringify({ comments: [] }));
      return '';
    }
    if (command === '/ffprobe') {
      return JSON.stringify({
        streams: [{ codec_type: 'video', codec_name: 'h264', height: 1080 }, { codec_type: 'audio', codec_name: 'aac' }],
        format: { duration: '120' },
      });
    }
    await writeFile(args[args.length - 1], 'output');
    return '';
  });
}

function fakePrisma() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    creatorVideo: { aggregate: vi.fn().mockResolvedValue({ _max: { seasonEpisode: 4 } }), update: vi.fn() },
  };
  return {
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    tx,
    archiveJob: { update: vi.fn().mockResolvedValue({}), create: vi.fn().mockResolvedValue({}) },
    archiveMediaFile: { upsert: vi.fn().mockResolvedValue({}), findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'f1' }) },
    creatorVideo: { update: vi.fn().mockResolvedValue({}) },
  };
}

async function tree(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await tree(full, base));
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

describe('runDownload', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  const stages: string[] = [];
  const context = (extra = {}) => ({
    prisma: prisma as unknown as PrismaClient,
    job: { id: 'j1', source: 'MANUAL', requestedByUserId: 'u1', requestedByUsername: 'sai' },
    video,
    options,
    signal: new AbortController().signal,
    minFreeGb: 0,
    reencodeEnabled: true,
    cookiesFile: null,
    browserToken: null,
    setStage: async (stage: string) => { stages.push(stage); },
    assertLease: vi.fn(async () => undefined),
    stagingName: 'job-1',
    note: vi.fn(async () => undefined),
    ...extra,
  }) as unknown as Parameters<typeof runDownload>[0];

  beforeEach(async () => {
    stages.length = 0;
    await rm(paths.library, { recursive: true, force: true });
    await mkdir(paths.staging, { recursive: true });
    prisma = fakePrisma();
    mocks.run.mockReset();
    fakeTools();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } })));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(paths.library, { recursive: true, force: true });
  });

  it('publishes an archive with every file Jellyfin needs', async () => {
    await runDownload(context());
    const base = 'gigguk - S2026E10301000 - 2026-10-30 - A stream part 1 [v123]';
    expect(await tree(paths.library)).toEqual([
      'gigguk/Season 2026/' + base + '-thumb.jpg',
      'gigguk/Season 2026/' + base + '.chat.json.gz',
      'gigguk/Season 2026/' + base + '.en.chat.ass',
      'gigguk/Season 2026/' + base + '.info.json',
      'gigguk/Season 2026/' + base + '.mkv',
      'gigguk/Season 2026/' + base + '.nfo',
      'gigguk/Season 2026/season.nfo',
      'gigguk/fanart.jpg',
      'gigguk/landscape.jpg',
      'gigguk/poster.jpg',
      'gigguk/tvshow.nfo',
    ]);
    expect(stages).toEqual(['reading metadata', 'downloading', 'remuxing', 'validating', 'archiving chat', 'publishing']);
  });

  it('keeps its tool arguments', async () => {
    await runDownload(context({ cookiesFile: '/tmp/cookies.txt' }));
    const calls = mocks.run.mock.calls.map(([command, args]) => [command, args]);
    expect(calls[0]).toEqual(['/tools/ytdlp', ['-J', '--no-playlist', '--cookies', '/tmp/cookies.txt', 'https://www.twitch.tv/videos/123']]);
    const download = calls[1][1] as string[];
    expect(download.slice(0, 7)).toEqual(['--no-playlist', '--ffmpeg-location', '/ffmpeg', '-N', '6', '-f', '1080p60']);
    expect(download.slice(-3)).toEqual(['--cookies', '/tmp/cookies.txt', 'https://www.twitch.tv/videos/123']);
    const remux = calls.find(([command, args]) => command === '/ffmpeg' && (args as string[]).includes('-c')) as [string, string[]];
    expect(remux[1].map((arg) => path.basename(arg))).toEqual([
      '-y', '-v', 'error', '-i', 'video.mp4', '-i', 'chapters.ffmeta', '-map_chapters', '1',
      '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '0', '-c', 'copy', 'out.mkv',
    ]);
  });

  it('writes the same metadata', async () => {
    await runDownload(context());
    const season = path.join(paths.library, 'gigguk/Season 2026');
    const base = 'gigguk - S2026E10301000 - 2026-10-30 - A stream part 1 [v123]';
    const nfo = await readFile(path.join(season, `${base}.nfo`), 'utf8');
    expect(nfo).toContain('<title>A stream: part 1</title>');
    expect(nfo).toContain('<uniqueid type="twitch" default="true">123</uniqueid>');
    expect(nfo).toContain('twitch-v123');
    expect(nfo).toContain('<genre>Elden Ring</genre>');
    expect(await readFile(path.join(season, 'season.nfo'), 'utf8')).toContain('2026');
    const show = await readFile(path.join(paths.library, 'gigguk/tvshow.nfo'), 'utf8');
    expect(show).toContain('Gigguk');
    expect(show).toContain('77');
    expect(await readFile(path.join(season, `${base}.info.json`), 'utf8')).not.toContain('signed');
  });

  it('records the file, the refresh, the chapters and the next re-encode', async () => {
    await runDownload(context());
    const relativePath = 'gigguk/Season 2026/gigguk - S2026E10301000 - 2026-10-30 - A stream part 1 [v123].mkv';
    const upsert = prisma.archiveMediaFile.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ platform_relativePath: { platform: 'TWITCH', relativePath } });
    expect(upsert.create).toMatchObject({
      platform: 'TWITCH', videoId: 'v1', relativePath, sizeBytes: BigInt(6), durationSeconds: 120,
      videoCodec: 'h264', height: 1080, keepForever: false,
    });
    expect(upsert.create.sidecars).toHaveLength(5);
    expect(prisma.archiveJob.update).toHaveBeenCalledWith({ where: { id: 'j1' }, data: { needsJellyfinRefresh: true } });
    expect(prisma.creatorVideo.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { category: 'Elden Ring', chapters: [{ start: 0, title: 'Elden Ring' }] },
    });
    expect(prisma.archiveJob.create).toHaveBeenCalledWith({
      data: {
        platform: 'TWITCH', kind: 'REENCODE', videoId: 'v1', mediaFileId: 'f1', source: 'MANUAL',
        requestedByUserId: 'u1', requestedByUsername: 'sai',
      },
    });
  });

  it('leaves no staging behind, and checks the lease before touching the library', async () => {
    const assertLease = vi.fn(async () => undefined);
    await runDownload(context({ assertLease }));
    expect(await readdir(paths.staging)).toEqual([]);
    expect(assertLease).toHaveBeenCalledTimes(2);
  });

  it('pads the square avatar into a poster and fetches it only once', async () => {
    await runDownload(context());
    expect(mocks.run.mock.calls.filter(([, args]) => (args as string[]).includes('pad=iw:iw*3/2:0:(oh-ih)/2:black'))).toHaveLength(1);
    mocks.run.mockClear();
    fakeTools();
    await runDownload(context({ stagingName: 'job-2' }));
    expect(mocks.run.mock.calls.filter(([, args]) => (args as string[]).includes('pad=iw:iw*3/2:0:(oh-ih)/2:black'))).toHaveLength(0);
  });

  it('numbers a highlight in its own season', async () => {
    const highlight = { ...video, type: 'HIGHLIGHT' };
    await runDownload(context({ video: highlight }));
    expect(prisma.tx.creatorVideo.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { seasonEpisode: 5 } });
    expect((await tree(paths.library)).filter((name) => name.endsWith('.mkv'))).toEqual([
      'gigguk/Season 01 Highlights/gigguk - S01E05 - 2026-10-30 - A stream part 1 [v123].mkv',
    ]);
  });

  it('skips the chat and re-encode when they are turned off', async () => {
    await runDownload(context({ options: { ...options, chat: false, reencode: false } }));
    expect(stages).not.toContain('archiving chat');
    expect((await tree(paths.library)).some((name) => name.includes('chat'))).toBe(false);
    expect(prisma.archiveJob.create).not.toHaveBeenCalled();
  });

  it('does not queue a re-encode when the feature is off', async () => {
    await runDownload(context({ reencodeEnabled: false }));
    expect(prisma.archiveJob.create).not.toHaveBeenCalled();
  });

  it('keeps the video when its chat cannot be fetched', async () => {
    mocks.run.mockImplementation(async (command: string, args: string[]) => {
      if (command === '/tools/td') throw new Error('no chat');
      if (command === '/tools/ytdlp' && args.includes('-J')) return JSON.stringify(info);
      if (command === '/tools/ytdlp') { await writeFile(args[args.indexOf('-o') + 1].replace('%(ext)s', 'mp4'), 'v'); return ''; }
      if (command === '/ffprobe') return JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264', height: 1080 }, { codec_type: 'audio', codec_name: 'aac' }], format: { duration: '120' } });
      await writeFile(args[args.length - 1], 'output');
      return '';
    });
    const note = vi.fn(async () => undefined);
    await runDownload(context({ note }));
    expect(note).toHaveBeenCalledWith(expect.stringContaining('Chat archive skipped'));
    expect((await tree(paths.library)).some((name) => name.endsWith('.mkv'))).toBe(true);
  });

  it('waits for a stream that is still live', async () => {
    fakeTools({ metadata: { ...info, live_status: 'is_live' } });
    await expect(runDownload(context())).rejects.toBeInstanceOf(WaitForRecordingError);
  });

  it('falls back to the second tool when yt-dlp cannot download', async () => {
    fakeTools({ download: () => { throw new ProcessFailedError('yt-dlp', 1, 'broken'); } });
    const stageNames: string[] = [];
    await runDownload(context({ setStage: async (stage: string) => { stageNames.push(stage); } }));
    expect(stageNames).toContain('downloading (fallback)');
    expect(mocks.run.mock.calls.some(([command, args]) => command === '/tools/td' && (args as string[])[0] === 'videodownload')).toBe(true);
  });

  it('carries on without metadata only when the extractor is what broke', async () => {
    fakeTools({ metadataFails: 'ERROR: Unsupported URL' });
    const note = vi.fn(async () => undefined);
    await runDownload(context({ note }));
    expect(note).toHaveBeenCalledWith('yt-dlp could not read the video, so trying the fallback tool');
    expect(mocks.run.mock.calls[1][1]).toContain('1080p60');

    fakeTools({ metadataFails: 'Sign in required 403' });
    await expect(runDownload(context({ stagingName: 'job-3' }))).rejects.toThrow('403');
  });

  it('refuses a download the disk cannot hold', async () => {
    await expect(runDownload(context({ minFreeGb: 10_000_000 }))).rejects.toBeInstanceOf(DiskGuardError);
  });

  it('refuses a file of the wrong length', async () => {
    mocks.run.mockImplementation(async (command: string, args: string[]) => {
      if (command === '/tools/ytdlp' && args.includes('-J')) return JSON.stringify(info);
      if (command === '/tools/ytdlp') { await writeFile(args[args.indexOf('-o') + 1].replace('%(ext)s', 'mp4'), 'v'); return ''; }
      if (command === '/ffprobe') return JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264' }, { codec_type: 'audio', codec_name: 'aac' }], format: { duration: '60' } });
      await writeFile(args[args.length - 1], 'output');
      return '';
    });
    await expect(runDownload(context())).rejects.toThrow('duration mismatch');
    expect((await stat(paths.library)).isDirectory()).toBe(true);
    expect((await tree(paths.library)).some((name) => name.endsWith('.mkv') && !name.startsWith('.staging'))).toBe(false);
  });
});

describe('validateDuration', () => {
  it('allows ten seconds or one percent, whichever is more', () => {
    expect(validateDuration(110, 120)).toBe(true);
    expect(validateDuration(100, 120)).toBe(false);
    expect(validateDuration(3570, 3600)).toBe(true);
    expect(validateDuration(3550, 3600)).toBe(false);
  });
});
