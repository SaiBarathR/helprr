import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient, ArchiveJob } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dirs: { library: '' },
  ffmpeg: vi.fn(),
}));

vi.mock('./env', () => ({
  libraryFor: () => ({
    root: mocks.dirs.library,
    staging: path.join(mocks.dirs.library, '.staging'),
    originals: path.join(mocks.dirs.library, '.originals'),
  }),
  FFMPEG: 'ffmpeg',
  FFPROBE: 'ffprobe',
}));
vi.mock('./process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./process')>()),
  run: vi.fn(async (command: string, args: string[], options?: RunOptions) => {
    if (command === 'ffmpeg') return mocks.ffmpeg(args, options);
    const file = args[args.length - 1];
    const codec = file.endsWith('out.mkv') ? 'hevc' : 'h264';
    return JSON.stringify({ streams: [{ codec_name: codec }], format: { duration: '60' } });
  }),
}));

import { JobCancelledError, type RunOptions } from './process';
import { encodeProgressReader, runReencode } from './reencode';

const library = (relative: string) => path.join(mocks.dirs.library, relative);
const output = (args: string[]) => args[args.length - 1];

function setup() {
  const update = vi.fn().mockResolvedValue({});
  const prisma = {
    archiveMediaFile: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'f', relativePath: 'a/x.mkv', originalRelativePath: null }),
      update,
    },
    archiveJob: { update: vi.fn().mockResolvedValue({}) },
  };
  const jobUpdate = prisma.archiveJob.update;
  const note = vi.fn().mockResolvedValue(undefined);
  const setStage = vi.fn().mockResolvedValue(undefined);
  const start = () => runReencode({
    prisma: prisma as unknown as PrismaClient,
    job: { id: 'j', mediaFileId: 'f' } as ArchiveJob,
    signal: new AbortController().signal,
    quality: 20,
    preset: 'faster',
    keepOriginalDays: 3,
    setStage,
    note,
    assertLease: vi.fn().mockResolvedValue(undefined),
    stagingName: 'stage',
  });
  return { update, jobUpdate, note, setStage, start };
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
    expect(fallback[fallback.indexOf('-reinit_filter') + 1]).toBe('0');
    expect(fallback.indexOf('-reinit_filter')).toBeLessThan(fallback.indexOf('-i'));
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

  it('saves progress and time left while it encodes, at most every few seconds', async () => {
    mocks.ffmpeg.mockImplementation(async (args: string[], options: RunOptions) => {
      for (const line of ['out_time_us=30000000', 'speed=2x', 'progress=continue', 'out_time_us=45000000', 'progress=continue']) {
        options.onStdoutLine!(line);
      }
      await writeFile(output(args), 'small');
    });
    const { jobUpdate, start } = setup();

    await start();

    const args: string[] = mocks.ffmpeg.mock.calls[0][0];
    expect(args.slice(args.indexOf('-progress'), args.indexOf('-progress') + 2)).toEqual(['-progress', 'pipe:1']);
    expect(args).toContain('-nostats');
    const progressWrites = jobUpdate.mock.calls.filter(([call]) => 'progress' in call.data);
    expect(progressWrites).toEqual([[{ where: { id: 'j' }, data: { progress: 0.5, etaSeconds: 15 } }]]);
  });

  it('starts the software fallback from zero, not from where the hardware attempt stopped', async () => {
    mocks.ffmpeg
      .mockImplementationOnce(async (_args: string[], options: RunOptions) => {
        ['out_time_us=42000000', 'speed=3x', 'progress=continue'].forEach(options.onStdoutLine!);
        throw new Error('ffmpeg exited with 218: Impossible to convert between the formats');
      })
      .mockImplementationOnce(async (args: string[], options: RunOptions) => {
        ['out_time_us=N/A', 'speed=N/A', 'progress=continue'].forEach(options.onStdoutLine!);
        await writeFile(output(args), 'small');
      });
    const { jobUpdate, start } = setup();

    await start();

    const progressWrites = jobUpdate.mock.calls.filter(([call]) => 'progress' in call.data).map(([call]) => call.data);
    expect(progressWrites).toEqual([{ progress: 0.7, etaSeconds: 6 }, { progress: 0, etaSeconds: null }]);
  });

  it('waits for a slow progress write before validating, and skips saves while it runs', async () => {
    let finishWrite!: () => void;
    mocks.ffmpeg.mockImplementation(async (args: string[], options: RunOptions) => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(1_000_000);
      options.onStdoutLine!('out_time_us=10000000');
      options.onStdoutLine!('progress=continue');
      now.mockReturnValue(1_010_000);
      options.onStdoutLine!('out_time_us=20000000');
      options.onStdoutLine!('progress=continue');
      now.mockRestore();
      await writeFile(output(args), 'small');
    });
    const { jobUpdate, setStage, start } = setup();
    jobUpdate.mockImplementationOnce(() => new Promise((resolve) => { finishWrite = () => resolve({}); }));

    const running = start();
    await vi.waitFor(() => expect(jobUpdate).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(setStage).not.toHaveBeenCalledWith('validating');

    finishWrite();
    await running;

    expect(setStage).toHaveBeenCalledWith('validating');
    const progressWrites = jobUpdate.mock.calls.filter(([call]) => 'progress' in call.data);
    expect(progressWrites).toHaveLength(1);
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

describe('encodeProgressReader', () => {
  const read = (duration: number, lines: string[]) => {
    const blocks: Array<[number, number | null]> = [];
    const onLine = encodeProgressReader(duration, (progress, eta) => blocks.push([progress, eta]));
    lines.forEach(onLine);
    return blocks;
  };

  it('reports once a block, as a share of the duration', () => {
    expect(read(100, ['frame=10', 'out_time_us=25000000', 'speed= 5x', 'progress=continue', 'out_time_us=100000000', 'speed=5x', 'progress=end']))
      .toEqual([[0.25, 15], [1, 0]]);
  });

  it('starts at zero before ffmpeg knows its position or speed', () => {
    expect(read(100, ['out_time_us=N/A', 'speed=N/A', 'progress=continue'])).toEqual([[0, null]]);
    expect(read(100, ['out_time_us=-23000', 'progress=continue'])).toEqual([[0, null]]);
  });

  it('never passes 100%, and says nothing without a duration', () => {
    expect(read(10, ['out_time_us=12000000', 'progress=continue'])).toEqual([[1, null]]);
    expect(read(0, ['out_time_us=12000000', 'progress=continue'])).toEqual([]);
  });
});
