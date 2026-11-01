import { mkdir, mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const url = process.env.TWITCH_QUEUE_TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
const root = vi.hoisted(() => ({ dir: '' }));

vi.mock('./env', () => ({
  libraryFor: () => ({ root: root.dir, staging: `${root.dir}/.staging`, originals: `${root.dir}/.originals` }),
  FFMPEG: '/ffmpeg',
  FFPROBE: '/ffprobe',
  TOOLS_DIR: '/tools',
}));

import { runDeleteFiles } from './delete-files';
import { withFileLock } from './file-lock';

const lease = async () => undefined;

// Needs a migrated, disposable PostgreSQL; skipped without one.
describe.skipIf(!url || !url.endsWith('/helprr_migration_test'))('the last check before an automatic delete', () => {
  const db = prisma!;
  let fileId = '';
  let videoId = '';
  const onDisk = () => stat(path.join(root.dir, 'c/file.mkv')).then(() => true, () => false);
  const job = (generation: number, createdAt = new Date(), options: object = { retention: true, automatic: true, generation, reason: 'watched' }) => (
    db.archiveJob.create({
      data: {
        platform: 'YOUTUBE',
        kind: 'DELETE_FILES',
        mediaFileId: fileId,
        videoId,
        createdAt,
        options,
        requestedByUsername: 'Automatic cleanup',
      },
    })
  );
  const settings = (data: { autoCleanupEnabled?: boolean; cleanupGeneration?: number }) => db.youtubeSettings.upsert({
    where: { id: 'singleton' },
    update: data,
    create: { id: 'singleton', ...data },
  });

  beforeAll(async () => {
    root.dir = await mkdtemp(path.join(os.tmpdir(), 'cleanup-'));
  });
  beforeEach(async () => {
    await db.archiveJob.deleteMany();
    await db.creator.deleteMany();
    await db.archiveDeletedFile.deleteMany();
    await mkdir(path.join(root.dir, 'c'), { recursive: true });
    await writeFile(path.join(root.dir, 'c/file.mkv'), 'video');
    await settings({ autoCleanupEnabled: true, cleanupGeneration: 3 });
    const creator = await db.creator.create({ data: { platform: 'YOUTUBE', externalId: 'c', login: 'c', folderName: 'c', displayName: 'C' } });
    const video = await db.creatorVideo.create({
      data: { platform: 'YOUTUBE', externalId: 'v', creatorId: creator.id, type: 'UPLOAD', title: 'V', sourceCreatedAt: new Date(), durationSeconds: 60 },
    });
    videoId = video.id;
    const file = await db.archiveMediaFile.create({
      data: { platform: 'YOUTUBE', videoId, relativePath: 'c/file.mkv', sizeBytes: BigInt(5), durationSeconds: 60, videoCodec: 'h264', height: 1080 },
    });
    fileId = file.id;
  });
  afterAll(async () => {
    await db.archiveJob.deleteMany();
    await db.creator.deleteMany();
    await db.archiveDeletedFile.deleteMany();
    await db.youtubeSettings.deleteMany();
    await rm(root.dir, { recursive: true, force: true });
    await db.$disconnect();
  });

  it('deletes when nothing has changed, and records it under the system', async () => {
    await runDeleteFiles(db, await job(3), lease);
    expect(await onDisk()).toBe(false);
    expect(await db.archiveMediaFile.count({ where: { id: fileId } })).toBe(0);
    const audit = await db.fileOperationAudit.findFirst({ orderBy: { startedAt: 'desc' } });
    expect(audit).toMatchObject({ username: 'Automatic cleanup', service: 'YOUTUBE', mediaType: 'youtube-video' });
  });

  it('refuses when someone tapped keep forever after it was queued', async () => {
    await db.archiveMediaFile.update({ where: { id: fileId }, data: { keepForever: true } });
    await expect(runDeleteFiles(db, await job(3), lease)).rejects.toThrow('keep forever');
    expect(await onDisk()).toBe(true);
  });

  it('refuses when cleanup was turned off', async () => {
    await settings({ autoCleanupEnabled: false });
    await expect(runDeleteFiles(db, await job(3), lease)).rejects.toThrow('cleanup rules changed');
    expect(await onDisk()).toBe(true);
  });

  it('refuses when the rules changed', async () => {
    await settings({ cleanupGeneration: 4 });
    await expect(runDeleteFiles(db, await job(3), lease)).rejects.toThrow('cleanup rules changed');
    expect(await onDisk()).toBe(true);
  });

  it('refuses a job that waited too long', async () => {
    await expect(runDeleteFiles(db, await job(3, new Date(Date.now() - 11 * 60_000)), lease)).rejects.toThrow('waited too long');
    expect(await onDisk()).toBe(true);
  });

  it('refuses when a download started on the video', async () => {
    await db.archiveJob.create({ data: { platform: 'YOUTUBE', kind: 'DOWNLOAD', videoId } });
    await expect(runDeleteFiles(db, await job(3), lease)).rejects.toThrow('in use again');
    expect(await onDisk()).toBe(true);
  });

  it('settles a keep and a delete arriving together: the file is kept, or it was gone first', async () => {
    const keep = withFileLock(db, fileId, async (tx) => {
      await tx.archiveMediaFile.updateMany({ where: { id: fileId }, data: { keepForever: true } });
    });
    const queued = await job(3);
    const remove = runDeleteFiles(db, queued, lease).then(() => 'deleted', () => 'refused');
    const [, outcome] = await Promise.all([keep, remove]);

    const row = await db.archiveMediaFile.findUnique({ where: { id: fileId } });
    if (outcome === 'refused') {
      expect(row?.keepForever).toBe(true);
      expect(await onDisk()).toBe(true);
    } else {
      expect(row).toBeNull();
      expect(await onDisk()).toBe(false);
    }
  });

  it('leaves a person confirming a delete able to override keep forever', async () => {
    await db.archiveMediaFile.update({ where: { id: fileId }, data: { keepForever: true } });
    await runDeleteFiles(db, await job(3, new Date(), {}), lease);
    expect(await onDisk()).toBe(false);
  });
});
