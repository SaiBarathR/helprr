import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient, TwitchJob } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ library: { dir: '' }, codec: 'h264' }));
vi.mock('./env', () => ({
  get LIBRARY_DIR() { return mocks.library.dir; },
  ORIGINALS_DIR: '',
  STAGING_DIR: '',
  FFMPEG: '',
  FFPROBE: '',
}));
vi.mock('./process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./process')>()),
  run: vi.fn(async () => JSON.stringify({ streams: [{ codec_name: mocks.codec }], format: { duration: '60' } })),
}));

import { DeferJobError } from './process';
import { measureParkedOriginals, runDeleteOriginal, runRestoreOriginal } from './original-files';
import { deleteExpiredOriginals } from './reencode';

const job = { id: 'j', mediaFileId: 'f', requestedByUserId: 'u', requestedByUsername: 'sai' } as TwitchJob;

function fakePrisma(row: Record<string, unknown> | null, busyJobs = 0) {
  const prisma = {
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
});
afterEach(() => rm(mocks.library.dir, { recursive: true, force: true }));

describe('runRestoreOriginal', () => {
  it('puts the original back over the re-encoded file and clears the re-encode', async () => {
    await writeLibrary({ 'a/x.mkv': 'small', '.originals/a/x.mkv': 'the much larger original' });
    const { mock, client } = fakePrisma(file());

    await runRestoreOriginal(client, job);

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

  it('finishes a restore interrupted right after the rename', async () => {
    await writeLibrary({ 'a/x.mkv': 'the original' });
    const { mock, client } = fakePrisma(file());

    await runRestoreOriginal(client, job);

    expect(await readFile(inLibrary('a/x.mkv'), 'utf8')).toBe('the original');
    expect(mock.twitchMediaFile.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reencodedAt: null, originalRelativePath: null }),
    }));
  });

  it('leaves everything alone when the original is really gone', async () => {
    await writeLibrary({ 'a/x.mkv': 'the re-encoded file' });
    mocks.codec = 'hevc';
    const { mock, client } = fakePrisma(file());

    await expect(runRestoreOriginal(client, job)).rejects.toThrow('the original is gone');

    expect(await readFile(inLibrary('a/x.mkv'), 'utf8')).toBe('the re-encoded file');
    expect(mock.twitchMediaFile.update).not.toHaveBeenCalled();
  });

  it('refuses a file with no original', async () => {
    await writeLibrary({ 'a/x.mkv': 'file' });
    const { client } = fakePrisma(file({ originalRelativePath: null }));
    await expect(runRestoreOriginal(client, job)).rejects.toThrow('no original to restore');
  });

  it('refuses a stored path outside the library', async () => {
    await writeLibrary({ 'a/x.mkv': 'file' });
    const { client } = fakePrisma(file({ originalRelativePath: '../../etc/passwd' }));
    await expect(runRestoreOriginal(client, job)).rejects.toThrow(/outside the library/);
  });

  it('refuses an original reached through a link leading out', async () => {
    await writeLibrary({ 'a/x.mkv': 'file' });
    const outside = await mkdtemp(path.join(os.tmpdir(), 'twitch-outside-'));
    await writeFile(path.join(outside, 'x.mkv'), 'not ours');
    await symlink(outside, inLibrary('linked'));
    const { client } = fakePrisma(file({ originalRelativePath: 'linked/x.mkv' }));

    await expect(runRestoreOriginal(client, job)).rejects.toThrow(/leads outside the library/);

    expect(await readFile(path.join(outside, 'x.mkv'), 'utf8')).toBe('not ours');
    expect(await readFile(inLibrary('a/x.mkv'), 'utf8')).toBe('file');
    await rm(outside, { recursive: true, force: true });
  });

  it('waits for a running download or re-encode, and leaves the files alone', async () => {
    await writeLibrary({ 'a/x.mkv': 'small', '.originals/a/x.mkv': 'original' });
    const { mock, client } = fakePrisma(file(), 1);

    await expect(runRestoreOriginal(client, job)).rejects.toBeInstanceOf(DeferJobError);

    expect(await readFile(inLibrary('a/x.mkv'), 'utf8')).toBe('small');
    expect(mock.twitchJob.count.mock.calls[0][0].where.kind).toEqual({ in: ['DOWNLOAD', 'REENCODE'] });
  });
});

describe('runDeleteOriginal', () => {
  it('removes only the original, and records what it freed and who asked', async () => {
    await writeLibrary({ 'a/x.mkv': 'small', '.originals/a/x.mkv': 'original!' });
    const { mock, client } = fakePrisma(file());

    await runDeleteOriginal(client, job);

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

    await runDeleteOriginal(client, job);

    expect(mock.twitchMediaFile.update).toHaveBeenCalledOnce();
    quiet.mockRestore();
  });

  it('does nothing once the original has already gone', async () => {
    const { mock, client } = fakePrisma(file({ originalRelativePath: null }));
    await runDeleteOriginal(client, job);
    expect(mock.twitchMediaFile.update).not.toHaveBeenCalled();
  });

  it('never deletes through a stored path outside the library', async () => {
    const { mock, client } = fakePrisma(file({ originalRelativePath: '../../etc/passwd' }));
    await expect(runDeleteOriginal(client, job)).rejects.toThrow(/outside the library/);
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
