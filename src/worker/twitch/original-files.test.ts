import { mkdir, mkdtemp, readFile, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient, TwitchJob } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ library: { dir: '' }, codec: 'h264', duration: '60', probeFails: false }));
vi.mock('./env', () => ({
  get LIBRARY_DIR() { return mocks.library.dir; },
  ORIGINALS_DIR: '',
  STAGING_DIR: '',
  FFMPEG: '',
  FFPROBE: '',
}));
vi.mock('./process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./process')>()),
  run: vi.fn(async () => {
    if (mocks.probeFails) throw new Error('Invalid data found when processing input');
    return JSON.stringify({ streams: [{ codec_name: mocks.codec }], format: { duration: mocks.duration } });
  }),
}));

import { DeferJobError } from './process';
import { measureParkedOriginals, runDeleteOriginal, runRestoreOriginal } from './original-files';
import { deleteExpiredOriginals } from './reencode';

const reencodedAt = new Date('2026-10-30T02:00:00.000Z');
const job = {
  id: 'j', mediaFileId: 'f', requestedByUserId: 'u', requestedByUsername: 'sai', options: { generation: reencodedAt.toISOString() },
} as unknown as TwitchJob;
const lease = async () => undefined;

function fakePrisma(row: Record<string, unknown> | null, busyJobs = 0) {
  const prisma = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn((work: (tx: unknown) => unknown) => work(prisma)),
    twitchMediaFile: {
      findUnique: vi.fn().mockResolvedValue(row),
      findMany: vi.fn().mockResolvedValue(row ? [row] : []),
      update: vi.fn().mockResolvedValue({}),
    },
    twitchJob: { count: vi.fn().mockResolvedValue(busyJobs), update: vi.fn().mockResolvedValue({}) },
    twitchDeletedFile: { create: vi.fn().mockResolvedValue({}) },
    fileOperationAudit: { create: vi.fn().mockResolvedValue({}) },
  };
  return { mock: prisma, client: prisma as unknown as PrismaClient };
}

const file = (overrides: Record<string, unknown> = {}) => ({
  id: 'f',
  videoId: 'v',
  relativePath: 'a/x.mkv',
  originalRelativePath: '.originals/a/x.mkv',
  originalSizeBytes: null,
  originalDeleteAfter: new Date('2026-10-01T00:00:00.000Z'),
  durationSeconds: 60,
  reencodedAt,
  jobs: [],
  video: { title: 'A stream', twitchVideoId: '100', streamer: { displayName: 'Gigguk' } },
  ...overrides,
});

const inLibrary = (relative: string) => path.join(mocks.library.dir, relative);

async function writeLibrary(files: Record<string, string>) {
  for (const [relative, content] of Object.entries(files)) {
    await mkdir(path.dirname(inLibrary(relative)), { recursive: true });
    await writeFile(inLibrary(relative), content);
  }
}

beforeEach(async () => {
  mocks.library.dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-original-'));
  mocks.codec = 'h264';
  mocks.duration = '60';
  mocks.probeFails = false;
});
afterEach(() => rm(mocks.library.dir, { recursive: true, force: true }));

describe('runRestoreOriginal', () => {
  it('puts the original back over the re-encoded file and clears the re-encode', async () => {
    await writeLibrary({ 'a/x.mkv': 'small', '.originals/a/x.mkv': 'the much larger original' });
    const { mock, client } = fakePrisma(file());

    await runRestoreOriginal(client, job, lease);

    expect(await readFile(inLibrary('a/x.mkv'), 'utf8')).toBe('the much larger original');
    await expect(stat(inLibrary('.originals/a/x.mkv'))).rejects.toThrow();
    expect(mock.twitchMediaFile.update).toHaveBeenCalledWith({
      where: { id: 'f' },
      data: expect.objectContaining({
        sizeBytes: BigInt('the much larger original'.length),
        videoCodec: 'h264',
        reencodedAt: null,
        originalRelativePath: null,
        originalSizeBytes: null,
      }),
    });
    expect(mock.twitchJob.update).toHaveBeenCalledWith({ where: { id: 'j' }, data: { needsJellyfinRefresh: true } });
  });

  it('keeps the playable copy when the original cannot be read', async () => {
    await writeLibrary({ 'a/x.mkv': 'small', '.originals/a/x.mkv': 'corrupt' });
    mocks.probeFails = true;
    const { mock, client } = fakePrisma(file());

    await expect(runRestoreOriginal(client, job, lease)).rejects.toThrow('Invalid data');

    expect(await readFile(inLibrary('a/x.mkv'), 'utf8')).toBe('small');
    expect(await readFile(inLibrary('.originals/a/x.mkv'), 'utf8')).toBe('corrupt');
    expect(mock.twitchMediaFile.update).not.toHaveBeenCalled();
  });

  it('keeps the playable copy when the original is cut short', async () => {
    await writeLibrary({ 'a/x.mkv': 'small', '.originals/a/x.mkv': 'cut' });
    mocks.duration = '12';
    const { client } = fakePrisma(file());

    await expect(runRestoreOriginal(client, job, lease)).rejects.toThrow('runs 12s of 60s');

    expect(await readFile(inLibrary('a/x.mkv'), 'utf8')).toBe('small');
  });

  it('keeps the playable copy when the original no longer matches its recorded size', async () => {
    await writeLibrary({ 'a/x.mkv': 'small', '.originals/a/x.mkv': 'the original, truncated later' });
    await truncate(inLibrary('.originals/a/x.mkv'), 5);
    const { client } = fakePrisma(file({ originalSizeBytes: BigInt(29) }));

    await expect(runRestoreOriginal(client, job, lease)).rejects.toThrow('changed size');

    expect(await readFile(inLibrary('a/x.mkv'), 'utf8')).toBe('small');
  });

  it('refuses a parked path that is a link rather than a file', async () => {
    await writeLibrary({ 'a/x.mkv': 'small', 'elsewhere.mkv': 'not the original' });
    await mkdir(inLibrary('.originals/a'), { recursive: true });
    await symlink(inLibrary('elsewhere.mkv'), inLibrary('.originals/a/x.mkv'));
    const { client } = fakePrisma(file());

    await expect(runRestoreOriginal(client, job, lease)).rejects.toThrow('not a regular file');

    expect(await readFile(inLibrary('a/x.mkv'), 'utf8')).toBe('small');
  });

  it('does nothing when asked about a re-encode that has since been replaced', async () => {
    await writeLibrary({ 'a/x.mkv': 'newer encode', '.originals/a/x.mkv': 'newly parked original' });
    const { mock, client } = fakePrisma(file({ reencodedAt: new Date('2026-10-31T02:00:00.000Z') }));

    await runRestoreOriginal(client, job, lease);

    expect(await readFile(inLibrary('a/x.mkv'), 'utf8')).toBe('newer encode');
    expect(await readFile(inLibrary('.originals/a/x.mkv'), 'utf8')).toBe('newly parked original');
    expect(mock.twitchMediaFile.update).not.toHaveBeenCalled();
  });

  it('does nothing when the file changed while it waited for the lock', async () => {
    await writeLibrary({ 'a/x.mkv': 'newer encode', '.originals/a/x.mkv': 'newly parked original' });
    const { mock, client } = fakePrisma(file());
    mock.twitchMediaFile.findUnique
      .mockResolvedValueOnce(file())
      .mockResolvedValueOnce({ reencodedAt: new Date('2026-10-31T02:00:00.000Z'), originalRelativePath: '.originals/a/x.mkv' });

    await runRestoreOriginal(client, job, lease);

    expect(await readFile(inLibrary('a/x.mkv'), 'utf8')).toBe('newer encode');
    expect(mock.twitchMediaFile.update).not.toHaveBeenCalled();
  });

  it('finishes quietly when a retry finds the restore already done', async () => {
    await writeLibrary({ 'a/x.mkv': 'the original' });
    const { mock, client } = fakePrisma(file({ reencodedAt: null, originalRelativePath: null }));

    await runRestoreOriginal(client, job, lease);

    expect(mock.twitchMediaFile.update).not.toHaveBeenCalled();
  });

  it('stops before touching anything when the lease has gone', async () => {
    await writeLibrary({ 'a/x.mkv': 'small', '.originals/a/x.mkv': 'original' });
    const { client } = fakePrisma(file());

    await expect(runRestoreOriginal(client, job, async () => { throw new Error('lease lost'); })).rejects.toThrow('lease lost');

    expect(await readFile(inLibrary('a/x.mkv'), 'utf8')).toBe('small');
  });

  it('finishes a restore interrupted right after the rename', async () => {
    await writeLibrary({ 'a/x.mkv': 'the original' });
    const { mock, client } = fakePrisma(file());

    await runRestoreOriginal(client, job, lease);

    expect(await readFile(inLibrary('a/x.mkv'), 'utf8')).toBe('the original');
    expect(mock.twitchMediaFile.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reencodedAt: null, originalRelativePath: null }),
    }));
  });

  it('leaves everything alone when the original is really gone', async () => {
    await writeLibrary({ 'a/x.mkv': 'the re-encoded file' });
    mocks.codec = 'hevc';
    const { mock, client } = fakePrisma(file());

    await expect(runRestoreOriginal(client, job, lease)).rejects.toThrow('the original is gone');

    expect(await readFile(inLibrary('a/x.mkv'), 'utf8')).toBe('the re-encoded file');
    expect(mock.twitchMediaFile.update).not.toHaveBeenCalled();
  });

  it('refuses a file with no original', async () => {
    await writeLibrary({ 'a/x.mkv': 'file' });
    const { client } = fakePrisma(file({ originalRelativePath: null }));
    await expect(runRestoreOriginal(client, job, lease)).rejects.toThrow('no original to restore');
  });

  it('refuses a stored path outside the library', async () => {
    await writeLibrary({ 'a/x.mkv': 'file' });
    const { client } = fakePrisma(file({ originalRelativePath: '../../etc/passwd' }));
    await expect(runRestoreOriginal(client, job, lease)).rejects.toThrow(/outside the library/);
  });

  it('refuses an original reached through a link leading out', async () => {
    await writeLibrary({ 'a/x.mkv': 'file' });
    const outside = await mkdtemp(path.join(os.tmpdir(), 'twitch-outside-'));
    await writeFile(path.join(outside, 'x.mkv'), 'not ours');
    await symlink(outside, inLibrary('linked'));
    const { client } = fakePrisma(file({ originalRelativePath: 'linked/x.mkv' }));

    await expect(runRestoreOriginal(client, job, lease)).rejects.toThrow(/leads outside the library/);

    expect(await readFile(path.join(outside, 'x.mkv'), 'utf8')).toBe('not ours');
    expect(await readFile(inLibrary('a/x.mkv'), 'utf8')).toBe('file');
    await rm(outside, { recursive: true, force: true });
  });

  it('waits for a running download or re-encode, and leaves the files alone', async () => {
    await writeLibrary({ 'a/x.mkv': 'small', '.originals/a/x.mkv': 'original' });
    const { mock, client } = fakePrisma(file(), 1);

    await expect(runRestoreOriginal(client, job, lease)).rejects.toBeInstanceOf(DeferJobError);

    expect(await readFile(inLibrary('a/x.mkv'), 'utf8')).toBe('small');
    expect(mock.twitchJob.count.mock.calls[0][0].where.kind).toEqual({ in: ['DOWNLOAD', 'REENCODE'] });
  });
});

describe('runDeleteOriginal', () => {
  it('removes only the original, and records what it freed and who asked', async () => {
    await writeLibrary({ 'a/x.mkv': 'small', '.originals/a/x.mkv': 'original!' });
    const { mock, client } = fakePrisma(file());

    await runDeleteOriginal(client, job, lease);

    expect(await readFile(inLibrary('a/x.mkv'), 'utf8')).toBe('small');
    await expect(stat(inLibrary('.originals/a/x.mkv'))).rejects.toThrow();
    expect(mock.twitchMediaFile.update.mock.calls[0][0].data).toMatchObject({
      originalRelativePath: null,
      originalDeleteAfter: null,
      originalDeletedAt: expect.any(Date),
    });
    expect(mock.twitchDeletedFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'ORIGINAL', cause: 'PERSON', deletedBy: 'sai', freedBytes: BigInt(9), streamer: 'Gigguk' }),
    });
    expect(mock.fileOperationAudit.create).toHaveBeenCalledOnce();
  });

  it('still finishes when the history row cannot be written', async () => {
    await writeLibrary({ '.originals/a/x.mkv': 'original!' });
    const { mock, client } = fakePrisma(file());
    mock.twitchDeletedFile.create.mockRejectedValue(new Error('database hiccup'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await runDeleteOriginal(client, job, lease);

    expect(mock.twitchMediaFile.update).toHaveBeenCalledOnce();
    quiet.mockRestore();
  });

  it('does nothing once the original has already gone', async () => {
    const { mock, client } = fakePrisma(file({ originalRelativePath: null }));
    await runDeleteOriginal(client, job, lease);
    expect(mock.twitchMediaFile.update).not.toHaveBeenCalled();
  });

  it('never deletes through a stored path outside the library', async () => {
    const { mock, client } = fakePrisma(file({ originalRelativePath: '../../etc/passwd' }));
    await expect(runDeleteOriginal(client, job, lease)).rejects.toThrow(/outside the library/);
    expect(mock.twitchMediaFile.update).not.toHaveBeenCalled();
    expect(mock.fileOperationAudit.create).toHaveBeenCalledOnce();
  });
});

describe('deleteExpiredOriginals', () => {
  it('leaves an original alone while a job is on its file', async () => {
    const { mock, client } = fakePrisma(null);
    await deleteExpiredOriginals(client);
    expect(mock.twitchMediaFile.findMany.mock.calls[0][0].where.jobs).toEqual({
      none: { state: { in: ['QUEUED', 'BLOCKED', 'RUNNING', 'RETRY_WAIT'] } },
    });
  });

  it.each([
    ['a restore was accepted after the list was read', { jobs: [{ id: 'restore' }] }],
    ['a later re-encode gave it a new date', { originalDeleteAfter: new Date('2100-01-01T00:00:00.000Z') }],
    ['it has already gone', { originalRelativePath: null }],
  ])('deletes nothing when %s', async (_name, change) => {
    await writeLibrary({ '.originals/a/x.mkv': 'original!' });
    const { mock, client } = fakePrisma(file({ ...change }));
    mock.twitchMediaFile.findMany.mockResolvedValue([file()]);

    expect(await deleteExpiredOriginals(client)).toBe(0);

    expect(await readFile(inLibrary('.originals/a/x.mkv'), 'utf8')).toBe('original!');
    expect(mock.twitchDeletedFile.create).not.toHaveBeenCalled();
  });

  it('records the space freed once the keep period ends', async () => {
    await writeLibrary({ '.originals/a/x.mkv': 'original!' });
    const { mock, client } = fakePrisma(file());

    await deleteExpiredOriginals(client);

    await expect(stat(inLibrary('.originals/a/x.mkv'))).rejects.toThrow();
    expect(mock.twitchDeletedFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'ORIGINAL', cause: 'KEEP_PERIOD', freedBytes: BigInt(9) }),
    });
  });
});

describe('measureParkedOriginals', () => {
  it('fills in the size of a parked original', async () => {
    await writeLibrary({ '.originals/a/x.mkv': 'original!' });
    const { mock, client } = fakePrisma(file());

    expect(await measureParkedOriginals(client)).toBe(1);

    expect(mock.twitchMediaFile.update).toHaveBeenCalledWith({ where: { id: 'f' }, data: { originalSizeBytes: BigInt(9) } });
  });

  it('skips one that is not there', async () => {
    const { mock, client } = fakePrisma(file());
    expect(await measureParkedOriginals(client)).toBe(0);
    expect(mock.twitchMediaFile.update).not.toHaveBeenCalled();
  });
});
