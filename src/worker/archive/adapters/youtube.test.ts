import { beforeEach, describe, expect, it, vi } from 'vitest';

const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../process', () => ({ run, ProcessFailedError: class extends Error {} }));
vi.mock('../tools', () => ({ toolPath: (tool: string) => `/tools/${tool}` }));
vi.mock('../pipeline', () => ({ WaitForRecordingError: class extends Error { name = 'WaitForRecordingError'; } }));
vi.mock('node:fs/promises', async (original) => ({
  ...await original<typeof import('node:fs/promises')>(),
  readdir: vi.fn(async () => ['video.info.json', 'video.mkv']),
}));

import { stat } from 'node:fs/promises';
import { encryptTwitchToken } from '@/lib/twitch/token-cipher';
import type { DownloadContext } from '../adapter';
import { youtubeAdapter, youtubeVideoArgs } from './youtube';

const date = new Date(2026, 9, 31, 17, 0);
const channel = {
  id: 'c', externalId: 'UCVlfe3MRSCZSeIWByrWHhkg', login: 'trashtaste', folderName: 'trashtaste', displayName: 'Trash Taste',
  description: 'A podcast', profileImageUrl: 'https://yt3.ggpht.com/a', offlineImageUrl: 'https://yt3.googleusercontent.com/b',
};
const video = {
  id: 'v', externalId: 'ZoZ7m020aJQ', type: 'UPLOAD', title: 'Anime Club: Just Got Spooky?', description: 'Episode',
  durationSeconds: 3600, sourceCreatedAt: date, availability: 'PUBLISHED', seasonEpisode: null, thumbnailUrl: 'https://i.ytimg.com/t.jpg',
  creator: channel,
};
const options = { quality: '1080', codec: 'compatible', chat: false, chapters: true, reencode: false, keepForever: false, sponsorblock: 'mark' };

const context = (extra: Record<string, unknown> = {}) => ({
  prisma: { archiveJob: { update: vi.fn(async () => undefined) } },
  job: { id: 'j' },
  video,
  options,
  signal: new AbortController().signal,
  cookiesFile: null,
  ...extra,
}) as unknown as DownloadContext;

describe('the YouTube adapter', () => {
  beforeEach(() => {
    run.mockReset();
    run.mockResolvedValue(JSON.stringify({ duration: 3600, requested_formats: [{ filesize: 900 }, { filesize_approx: 100 }] }));
  });

  it('reads a video with nothing from the host, on Node, with the selector the choice built', async () => {
    const prepared = await youtubeAdapter.prepare(context());
    const [tool, args] = run.mock.calls[0];
    expect(tool).toBe('/tools/ytdlpYoutube');
    expect(args).toEqual(expect.arrayContaining(['--ignore-config', '--no-playlist', '--js-runtimes', 'node']));
    expect(args[args.indexOf('-f') + 1]).toBe('bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b');
    expect(prepared.expectedBytes).toBe(1000);
  });

  it('never uses the tool Twitch relies on, and the smoke test reads the same way', () => {
    expect(youtubeVideoArgs('ZoZ7m020aJQ')).toEqual(expect.arrayContaining(['--js-runtimes', 'node', '-J']));
    expect(JSON.stringify(youtubeVideoArgs('ZoZ7m020aJQ'))).toContain('https://www.youtube.com/watch?v=ZoZ7m020aJQ');
  });

  it('plans for a generous size when YouTube gives none, so the disk guard stays safe', async () => {
    run.mockResolvedValue(JSON.stringify({ duration: 100, requested_formats: [{ filesize: null }] }));
    expect((await youtubeAdapter.prepare(context())).expectedBytes).toBe(150_000_000);
  });

  it.each(['is_live', 'is_upcoming'])('waits for a stream that is %s', async (live_status) => {
    run.mockResolvedValue(JSON.stringify({ live_status }));
    await expect(youtubeAdapter.prepare(context())).rejects.toMatchObject({ name: 'WaitForRecordingError' });
  });

  it('waits without asking YouTube while the sweep still sees it as live', async () => {
    await expect(youtubeAdapter.prepare(context({ video: { ...video, availability: 'RECORDING' } })))
      .rejects.toMatchObject({ name: 'WaitForRecordingError' });
    expect(run).not.toHaveBeenCalled();
  });

  it('downloads to MKV in staging, marks sponsors as chapters, and uses no cookies', async () => {
    run.mockResolvedValue('');
    const prepared = { info: {}, selector: 'SEL', duration: 1, expectedBytes: 1, audioOnly: false };
    const file = await youtubeAdapter.download(context(), '/staging/x', prepared as never);
    const args = run.mock.calls[0][1] as string[];
    expect(file).toBe('/staging/x/video.mkv');
    expect(args).toEqual(expect.arrayContaining(['--merge-output-format', 'mkv', '--embed-chapters', '--sponsorblock-mark', 'all', '-f', 'SEL']));
    expect(args).not.toContain('--cookies');
    expect(args).toContain('/staging/x/video.%(ext)s');
  });

  it('leaves the marks out when SponsorBlock is off', async () => {
    run.mockResolvedValue('');
    const off = context({ options: { ...options, sponsorblock: 'off' } });
    await youtubeAdapter.download(off, '/staging/x', { info: {}, selector: 'S', duration: 1, expectedBytes: 1, audioOnly: false } as never);
    expect(run.mock.calls[0][1]).not.toContain('--sponsorblock-mark');
  });

  it('cuts only sponsors on Remove, marks the rest, and expects a shorter file', async () => {
    run.mockResolvedValue('');
    const remove = context({ options: { ...options, sponsorblock: 'remove' } });
    await youtubeAdapter.download(remove, '/staging/x', { info: {}, selector: 'S', duration: 1, expectedBytes: 1, audioOnly: false } as never);
    expect(run.mock.calls[0][1]).toEqual(expect.arrayContaining(['--sponsorblock-mark', 'all', '--sponsorblock-remove', 'sponsor']));

    run.mockResolvedValue(JSON.stringify({ duration: 100 }));
    expect((await youtubeAdapter.prepare(remove)).mayBeShorter).toBe(true);
    expect((await youtubeAdapter.prepare(context())).mayBeShorter).toBe(false);
  });

  it('asks for captions only when wanted', async () => {
    expect(await youtubeAdapter.extras(context({ options: { ...options, captions: false } }), '/staging/x')).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it('never lets a refused caption request cost the video', async () => {
    const note = vi.fn(async () => undefined);
    run.mockRejectedValue(new Error('HTTP Error 429: Too Many Requests'));
    const wanted = context({ options: { ...options, captions: true }, setStage: vi.fn(async () => undefined), note });
    expect(await youtubeAdapter.extras(wanted, '/staging/x')).toEqual([]);
    expect(note).toHaveBeenCalledWith(expect.stringContaining('Captions skipped'));
  });

  it('stops for a cancel during captions, rather than carrying on', async () => {
    const abort = new AbortController();
    abort.abort();
    run.mockRejectedValue(new Error('cancelled'));
    const wanted = context({ options: { ...options, captions: true }, signal: abort.signal, setStage: vi.fn(async () => undefined), note: vi.fn() });
    await expect(youtubeAdapter.extras(wanted, '/staging/x')).rejects.toThrow('cancelled');
  });

  it('says so when a video has no captions yet', async () => {
    run.mockResolvedValue('');
    const note = vi.fn(async () => undefined);
    const wanted = context({ options: { ...options, captions: true }, setStage: vi.fn(async () => undefined), note });
    expect(await youtubeAdapter.extras(wanted, '/staging/x')).toEqual([]);
    expect(note).toHaveBeenCalledWith('YouTube has no English captions for this video yet');
  });

  describe('the spare account', () => {
    const prisma = (row: unknown) => ({ youtubeSettings: { findUnique: vi.fn(async () => row) } }) as never;
    const restricted = { ...video, ageRestricted: true };

    it('is never read for a normal video', async () => {
      const db = prisma({ cookies: 'enc', cookiesValid: true });
      expect((await youtubeAdapter.openSession(null, { prisma: db, video: video as never })).cookiesFile).toBeNull();
      expect((db as unknown as { youtubeSettings: { findUnique: ReturnType<typeof vi.fn> } }).youtubeSettings.findUnique).not.toHaveBeenCalled();
    });

    it('goes in a private file for that job alone, removed afterwards', async () => {
      vi.stubEnv('JWT_SECRET', 'test-only');
      const stored = encryptTwitchToken('# Netscape HTTP Cookie File\n');
      const session = await youtubeAdapter.openSession(null, { prisma: prisma({ cookies: stored, cookiesValid: null }), video: restricted as never });
      const file = session.cookiesFile!;
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      await session.release();
      await expect(stat(file)).rejects.toThrow();
      vi.unstubAllEnvs();
    });

    it.each([
      ['none is set', { cookies: null, cookiesValid: null }],
      ['it is known to be bad', { cookies: 'enc:v1:x', cookiesValid: false }],
    ])('is left out when %s', async (_label, row) => {
      expect((await youtubeAdapter.openSession(null, { prisma: prisma(row), video: restricted as never })).cookiesFile).toBeNull();
    });

    it('stops an age-restricted video before YouTube is asked, when there is no working account', async () => {
      await expect(youtubeAdapter.prepare(context({ video: restricted }))).rejects.toThrow('Sign in to confirm your age');
      expect(run).not.toHaveBeenCalled();
    });

    it('passes the file by path to every step, so the cookies are never in the arguments', async () => {
      await youtubeAdapter.prepare(context({ video: restricted, cookiesFile: '/tmp/x/cookies.txt' }));
      const args = run.mock.calls[0][1] as string[];
      expect(args.slice(args.indexOf('--cookies'), args.indexOf('--cookies') + 2)).toEqual(['--cookies', '/tmp/x/cookies.txt']);
    });
  });

  it('lays a video out under its year, with the tag cleanup needs to find it', async () => {
    const layout = await youtubeAdapter.layout(context(), { info: {}, duration: 1, expectedBytes: 1, audioOnly: false }, 3600);
    expect(layout.seriesFolder).toBe('trashtaste');
    expect(layout.seasonFolder).toBe('Season 2026');
    expect(layout.baseName).toBe('Trash Taste - S2026E10311700 - 2026-10-31 - Anime Club Just Got Spooky [ZoZ7m020aJQ]');
    expect(layout.episodeNfo).toContain('<tag>youtube-ZoZ7m020aJQ</tag>');
    expect(layout.episodeNfo).toContain('<uniqueid type="youtube" default="true">ZoZ7m020aJQ</uniqueid>');
    expect(layout.tvshowNfo).toContain('<uniqueid type="youtube" default="true">UCVlfe3MRSCZSeIWByrWHhkg</uniqueid>');
    expect(layout.artwork).toEqual([['poster.jpg', channel.profileImageUrl], ['fanart.jpg', channel.offlineImageUrl]]);
  });

  it('keeps Shorts in their own season, numbered once', async () => {
    const short = { ...video, type: 'SHORT', seasonEpisode: 7 };
    const layout = await youtubeAdapter.layout(context({ video: short }), { info: {}, duration: 1, expectedBytes: 1, audioOnly: false }, 30);
    expect(layout.seasonFolder).toBe('Season 01 Shorts');
    expect(layout.baseName).toContain('S01E07');
  });

  it.each([
    ['https://i.ytimg.com/vi/a/maxresdefault.jpg', true],
    ['https://yt3.ggpht.com/a', true],
    ['https://yt3.googleusercontent.com/a', true],
    ['http://i.ytimg.com/a', false],
    ['https://i.ytimg.com:8443/a', false],
    ['https://i.ytimg.com.evil.example/a', false],
    ['not a url', false],
  ])('judges artwork at %s', (url, allowed) => {
    expect(youtubeAdapter.isArtworkUrl(url)).toBe(allowed);
  });
});
