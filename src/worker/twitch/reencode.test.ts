import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient, TwitchJob } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dirs: { library: '' },
  ffmpeg: vi.fn(),
}));

vi.mock('./env', () => ({
  get LIBRARY_DIR() { return mocks.dirs.library; },
  get ORIGINALS_DIR() { return path.join(mocks.dirs.library, '.originals'); },
  get STAGING_DIR() { return path.join(mocks.dirs.library, '.staging'); },
  FFMPEG: 'ffmpeg',
  FFPROBE: 'ffprobe',
}));
vi.mock('./process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./process')>()),
  run: vi.fn(async (command: string, args: string[]) => {
    if (command === 'ffmpeg') return mocks.ffmpeg(args);
    const file = args[args.length - 1];
    const codec = file.endsWith('out.mkv') ? 'hevc' : 'h264';
    return JSON.stringify({ streams: [{ codec_name: codec }], format: { duration: '60' } });
  }),
}));

import { JobCancelledError } from './process';
import { runReencode } from './reencode';

const library = (relative: string) => path.join(mocks.dirs.library, relative);
const output = (args: string[]) => args[args.length - 1];

function setup() {
  const update = vi.fn().mockResolvedValue({});
  const prisma = {
    twitchMediaFile: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'f', relativePath: 'a/x.mkv', originalRelativePath: null }),
      update,
    },
    twitchJob: { update: vi.fn().mockResolvedValue({}) },
  };
  const note = vi.fn().mockResolvedValue(undefined);
  const start = () => runReencode({
    prisma: prisma as unknown as PrismaClient,
    job: { id: 'j', mediaFileId: 'f' } as TwitchJob,
    signal: new AbortController().signal,
    quality: 20,
    preset: 'faster',
    keepOriginalDays: 3,
    setStage: vi.fn().mockResolvedValue(undefined),
    note,
    assertLease: vi.fn().mockResolvedValue(undefined),
    stagingName: 'stage',
  });
  return { update, note, start };
}

beforeEach(async () => {
  mocks.dirs.library = await mkdtemp(path.join(os.tmpdir(), 'twitch-reencode-'));
  await mkdir(library('a'), { recursive: true });
  await writeFile(library('a/x.mkv'), 'the original, which is fairly large');
  mocks.ffmpeg.mockReset();
});
afterEach(() => rm(mocks.dirs.library, { recursive: true, force: true }));

describe('runReencode', () => {
  it('decodes on the GPU when it can, and swaps in the smaller file', async () => {
    mocks.ffmpeg.mockImplementation((args: string[]) => writeFile(output(args), 'small'));
    const { update, note, start } = setup();

    await start();

    expect(mocks.ffmpeg).toHaveBeenCalledOnce();
    expect(mocks.ffmpeg.mock.calls[0][0]).toContain('-hwaccel');
    expect(note).not.toHaveBeenCalled();
    expect(await readFile(library('a/x.mkv'), 'utf8')).toBe('small');
    expect(update.mock.calls[0][0].data).toMatchObject({ videoCodec: 'hevc', originalSizeBytes: BigInt(35), sizeBytes: BigInt(5), reencodeQuality: 20 });
  });

  it('falls back to software decoding when the hardware decoder gives up', async () => {
    mocks.ffmpeg
      .mockRejectedValueOnce(new Error('ffmpeg exited with 218: Impossible to convert between the formats'))
      .mockImplementationOnce((args: string[]) => writeFile(output(args), 'small'));
    const { note, start } = setup();

    await start();

    const fallback: string[] = mocks.ffmpeg.mock.calls[1][0];
    expect(fallback).not.toContain('-hwaccel');
    expect(fallback).toContain('hevc_qsv');
    expect(fallback).toContain('format=nv12,hwupload=extra_hw_frames=64');
    expect(note).toHaveBeenCalledWith(expect.stringContaining('decodes in software'));
    expect(await readFile(library('a/x.mkv'), 'utf8')).toBe('small');
  });

  it('does not try again after a cancel', async () => {
    mocks.ffmpeg.mockRejectedValueOnce(new JobCancelledError());
    const { start } = setup();

    await expect(start()).rejects.toBeInstanceOf(JobCancelledError);

    expect(mocks.ffmpeg).toHaveBeenCalledOnce();
    expect(await readFile(library('a/x.mkv'), 'utf8')).toBe('the original, which is fairly large');
  });

  it('leaves the original alone when both ways fail', async () => {
    mocks.ffmpeg.mockRejectedValue(new Error('ffmpeg exited with 1'));
    const { update, start } = setup();

    await expect(start()).rejects.toThrow('exited with 1');

    expect(await readFile(library('a/x.mkv'), 'utf8')).toBe('the original, which is fairly large');
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps the original and records the attempt when the encode is not worth it', async () => {
    mocks.ffmpeg.mockImplementation((args: string[]) => writeFile(output(args), 'x'.repeat(200)));
    const { update, start } = setup();

    await start();

    expect(await readFile(library('a/x.mkv'), 'utf8')).toBe('the original, which is fairly large');
    await expect(stat(library('.originals/a/x.mkv'))).rejects.toThrow();
    expect(update.mock.calls[0][0].data).toEqual({ reencodeSkippedAt: expect.any(Date), reencodeSkippedBytes: BigInt(200) });
  });
});
