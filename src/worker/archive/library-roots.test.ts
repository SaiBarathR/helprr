import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const roots = vi.hoisted(() => ({ TWITCH: '', YOUTUBE: '' }));
vi.mock('./env', () => ({
  libraryFor: (platform: 'TWITCH' | 'YOUTUBE') => ({
    root: roots[platform],
    staging: `${roots[platform]}/.staging`,
    originals: `${roots[platform]}/.originals`,
  }),
  FFMPEG: '/ffmpeg',
  FFPROBE: '/ffprobe',
  TOOLS_DIR: '/tools',
}));

import { forgetFilesDeletedElsewhere, runDeleteFiles } from './delete-files';
import { assertSeparateRoots, existsInLibrary, insideLibrary, isMountedFolder, removeInsideLibrary, replaceInsideLibrary } from './library-paths';
import { deleteExpiredOriginals } from './reencode';

const SAME = 'same/file.mkv';
const ORIGINAL = '.originals/same/file.mkv';

const exists = (file: string) => stat(file).then(() => true, () => false);

function fileRow(platform: 'TWITCH' | 'YOUTUBE', extra = {}) {
  return {
    id: `file-${platform}`, platform, videoId: `video-${platform}`, relativePath: SAME, sidecars: [], sizeBytes: BigInt(5),
    keepForever: false, originalRelativePath: null,
    video: { title: 'T', externalId: '1', creator: { displayName: 'N' } },
    ...extra,
  };
}

function fakePrisma(rows: Array<ReturnType<typeof fileRow>>) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    archiveJob: { count: vi.fn().mockResolvedValue(0), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    archiveMediaFile: {
      findUnique: vi.fn(async ({ where }) => ({
        ...rows.find((row) => row.id === where.id),
        jobs: [],
      })),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
  return {
    ...tx,
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    archiveMediaFile: {
      ...tx.archiveMediaFile,
      findMany: vi.fn(async ({ where }) => rows.filter((row) => row.platform === where.platform)),
    },
    archiveJob: { ...tx.archiveJob, update: vi.fn().mockResolvedValue({}) },
    archiveDeletedFile: { create: vi.fn().mockResolvedValue({}) },
    fileOperationAudit: { create: vi.fn().mockResolvedValue({}) },
  };
}

describe('library roots', () => {
  beforeEach(async () => {
    roots.TWITCH = await mkdtemp(path.join(os.tmpdir(), 'roots-twitch-'));
    roots.YOUTUBE = await mkdtemp(path.join(os.tmpdir(), 'roots-youtube-'));
    for (const root of [roots.TWITCH, roots.YOUTUBE]) {
      await mkdir(path.join(root, 'same'), { recursive: true });
      await writeFile(path.join(root, SAME), root);
    }
  });
  afterEach(async () => {
    await rm(roots.TWITCH, { recursive: true, force: true });
    await rm(roots.YOUTUBE, { recursive: true, force: true });
  });

  describe('assertSeparateRoots', () => {
    it('accepts two separate folders', async () => {
      await expect(assertSeparateRoots([roots.TWITCH, roots.YOUTUBE])).resolves.toBeUndefined();
    });

    it('refuses the same folder twice', async () => {
      await expect(assertSeparateRoots([roots.TWITCH, roots.TWITCH])).rejects.toThrow('overlap');
    });

    it('refuses one folder inside the other, either way round', async () => {
      const inner = path.join(roots.TWITCH, 'inner');
      await mkdir(inner);
      await expect(assertSeparateRoots([roots.TWITCH, inner])).rejects.toThrow('overlap');
      await expect(assertSeparateRoots([inner, roots.TWITCH])).rejects.toThrow('overlap');
    });

    it('sees through a link to the same folder', async () => {
      const alias = `${roots.YOUTUBE}-alias`;
      await symlink(roots.TWITCH, alias);
      await expect(assertSeparateRoots([roots.TWITCH, alias])).rejects.toThrow('overlap');
      await rm(alias);
    });

    it('allows a folder with a similar name', async () => {
      const similar = `${roots.TWITCH}-more`;
      await mkdir(similar);
      await expect(assertSeparateRoots([roots.TWITCH, similar])).resolves.toBeUndefined();
      await rm(similar, { recursive: true });
    });

    it('ignores a root that is not mounted', async () => {
      await expect(assertSeparateRoots([roots.TWITCH, `${roots.TWITCH}-missing`])).resolves.toBeUndefined();
    });
  });

  describe('paths inside a root', () => {
    it('cannot climb from one root into the other', () => {
      const climb = path.relative(roots.TWITCH, path.join(roots.YOUTUBE, SAME));
      expect(() => insideLibrary(climb, roots.TWITCH)).toThrow('outside the library');
    });

    it('follows a root the admin set to a link', async () => {
      const link = `${roots.TWITCH}-link`;
      await symlink(roots.TWITCH, link);
      expect(await existsInLibrary(SAME, link)).toBe(true);
      await removeInsideLibrary(SAME, link);
      expect(await exists(path.join(roots.TWITCH, SAME))).toBe(false);
      await rm(link);
    });

    it('refuses a link inside one root that leads to the other', async () => {
      await symlink(path.join(roots.YOUTUBE, 'same'), path.join(roots.TWITCH, 'escape'));
      await expect(removeInsideLibrary('escape/file.mkv', roots.TWITCH)).rejects.toThrow('leads outside the library');
      await expect(existsInLibrary('escape/file.mkv', roots.TWITCH)).rejects.toThrow('leads outside the library');
      await expect(replaceInsideLibrary('escape/file.mkv', 'same/moved.mkv', roots.TWITCH)).rejects.toThrow('leads outside the library');
      expect(await exists(path.join(roots.YOUTUBE, SAME))).toBe(true);
    });
  });

  describe('jobs and maintenance', () => {
    it('deletes a YouTube file from the YouTube root only', async () => {
      const prisma = fakePrisma([fileRow('YOUTUBE')]);
      const job = { id: 'job', mediaFileId: 'file-YOUTUBE', options: {}, createdAt: new Date(), requestedByUsername: 'sai', requestedByUserId: 'u' };
      await runDeleteFiles(prisma as unknown as PrismaClient, job as never, async () => undefined);
      expect(await exists(path.join(roots.YOUTUBE, SAME))).toBe(false);
      expect(await readFile(path.join(roots.TWITCH, SAME), 'utf8')).toBe(roots.TWITCH);
    });

    it('checks each file against its own root', async () => {
      await rm(path.join(roots.YOUTUBE, SAME));
      const prisma = fakePrisma([fileRow('TWITCH'), fileRow('YOUTUBE')]);
      await writeFile(path.join(roots.YOUTUBE, '.helprr-library'), '');
      expect(await forgetFilesDeletedElsewhere(prisma as unknown as PrismaClient, 'TWITCH')).toBe(0);
      expect(await forgetFilesDeletedElsewhere(prisma as unknown as PrismaClient, 'YOUTUBE')).toBe(1);
      expect(await exists(path.join(roots.TWITCH, SAME))).toBe(true);
    });

    it('treats an empty root with no marker as unmounted', async () => {
      await rm(path.join(roots.YOUTUBE, SAME));
      const prisma = fakePrisma([fileRow('YOUTUBE')]);
      expect(await forgetFilesDeletedElsewhere(prisma as unknown as PrismaClient, 'YOUTUBE')).toBe(0);
      expect(prisma.archiveMediaFile.delete).not.toHaveBeenCalled();
    });

    it('expires an original from its own root', async () => {
      const row = fileRow('YOUTUBE', { originalRelativePath: ORIGINAL, originalDeleteAfter: new Date(0) });
      for (const root of [roots.TWITCH, roots.YOUTUBE]) {
        await mkdir(path.join(root, '.originals/same'), { recursive: true });
        await writeFile(path.join(root, ORIGINAL), 'original');
      }
      const prisma = fakePrisma([row]);
      expect(await deleteExpiredOriginals(prisma as unknown as PrismaClient, 'YOUTUBE')).toBe(1);
      expect(await exists(path.join(roots.YOUTUBE, ORIGINAL))).toBe(false);
      expect(await exists(path.join(roots.TWITCH, ORIGINAL))).toBe(true);
    });
  });
});

describe('isMountedFolder', () => {
  it('knows a mount from a folder that merely exists', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'not-a-mount-'));
    expect(await isMountedFolder('/proc')).toBe(true);
    expect(await isMountedFolder(folder)).toBe(false);
    await rm(folder, { recursive: true });
  });
});
