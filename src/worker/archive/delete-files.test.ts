import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const library = vi.hoisted(() => ({ dir: '' }));
vi.mock('./env', () => ({
  libraryFor: () => ({ root: library.dir, staging: '', originals: '' }),
  FFMPEG: '',
  FFPROBE: '',
}));

import { forgetFilesDeletedElsewhere, insideLibrary, repairLibraryModes, runDeleteFiles } from './delete-files';

describe('insideLibrary', () => {
  it('resolves a normal path', () => {
    expect(insideLibrary('a/Season 2026/x.mkv', '/media/twitch')).toBe('/media/twitch/a/Season 2026/x.mkv');
  });

  it.each(['../secret', 'a/../../etc/passwd', '/etc/passwd', '.', ''])('refuses %s', (relative) => {
    expect(() => insideLibrary(relative, '/media/twitch')).toThrow(/outside the library/);
  });

  it('refuses a sibling folder sharing the prefix', () => {
    expect(() => insideLibrary('../twitch-other/x.mkv', '/media/twitch')).toThrow(/outside/);
  });
});

describe('runDeleteFiles', () => {
  afterEach(() => rm(library.dir, { recursive: true, force: true }));

  async function setup(options: unknown) {
    library.dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-del-'));
    await writeFile(path.join(library.dir, 'a.mkv'), '');
    const prisma = {
      archiveMediaFile: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'f', videoId: 'v', keepForever: true, relativePath: 'a.mkv', sidecars: [], originalRelativePath: null,
          platform: 'TWITCH',
          video: { title: 'A', externalId: '1', creator: { displayName: 'N' } },
        }),
        delete: vi.fn().mockResolvedValue({}),
      },
      archiveJob: { count: vi.fn().mockResolvedValue(0), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      fileOperationAudit: { create: vi.fn().mockResolvedValue({}) },
      archiveDeletedFile: { create: vi.fn().mockResolvedValue({}) },
    };
    return { prisma, job: { id: 'j', mediaFileId: 'f', options, createdAt: new Date(), requestedByUserId: 'u', requestedByUsername: 'u' } };
  }

  it('lets a person delete a keep-forever file they confirmed', async () => {
    const { prisma, job } = await setup({});
    await runDeleteFiles(prisma as never, job as never, async () => undefined);
    await expect(stat(path.join(library.dir, 'a.mkv'))).rejects.toThrow();
  });

  it('cancels a re-encode that has not started, rather than waiting for the night', async () => {
    const { prisma, job } = await setup({});
    await runDeleteFiles(prisma as never, job as never, async () => undefined);
    expect(prisma.archiveJob.updateMany).toHaveBeenCalledWith({
      where: { mediaFileId: 'f', kind: 'REENCODE', state: { in: ['QUEUED', 'RETRY_WAIT', 'BLOCKED'] } },
      data: expect.objectContaining({ state: 'CANCELLED' }),
    });
  });

  it('leaves a waiting re-encode alone for a rule, which yields instead', async () => {
    const { prisma, job } = await setup({ retention: true });
    prisma.archiveMediaFile.findUnique.mockResolvedValue({ ...(await prisma.archiveMediaFile.findUnique()), keepForever: false });
    await runDeleteFiles(prisma as never, job as never, async () => undefined);
    expect(prisma.archiveJob.updateMany).not.toHaveBeenCalled();
  });

  it('never lets retention delete one', async () => {
    const { prisma, job } = await setup({ retention: true });
    await expect(runDeleteFiles(prisma as never, job as never, async () => undefined)).rejects.toThrow(/keep forever/);
    expect(await stat(path.join(library.dir, 'a.mkv'))).toBeTruthy();
  });
});

describe('repairLibraryModes', () => {
  afterEach(() => rm(library.dir, { recursive: true, force: true }));

  it('makes older files and folders group-writable, and leaves the rest alone', async () => {
    library.dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-modes-'));
    await mkdir(path.join(library.dir, 'a/Season 1'), { recursive: true });
    await chmod(path.join(library.dir, 'a'), 0o755);
    await writeFile(path.join(library.dir, 'a/Season 1/old.mkv'), '');
    await chmod(path.join(library.dir, 'a/Season 1/old.mkv'), 0o644);
    await writeFile(path.join(library.dir, 'a/new.nfo'), '');
    await chmod(path.join(library.dir, 'a/new.nfo'), 0o664);
    const outside = path.join(library.dir, '..', `outside-${path.basename(library.dir)}`);
    await writeFile(outside, '');
    await chmod(outside, 0o644);
    await symlink(outside, path.join(library.dir, 'a/link'));

    await mkdir(path.join(library.dir, 'shared'));
    await chmod(path.join(library.dir, 'shared'), 0o2755);

    await repairLibraryModes(library.dir);

    expect((await stat(path.join(library.dir, 'shared'))).mode & 0o7777).toBe(0o2775);
    expect((await stat(outside)).mode & 0o777).toBe(0o644);
    await rm(outside);

    expect((await stat(path.join(library.dir, 'a'))).mode & 0o777).toBe(0o775);
    expect((await stat(path.join(library.dir, 'a/Season 1/old.mkv'))).mode & 0o777).toBe(0o664);
    expect(await repairLibraryModes(library.dir)).toBe(0);
  });
});

describe('forgetFilesDeletedElsewhere', () => {
  afterEach(() => rm(library.dir, { recursive: true, force: true }));

  const row = (id: string) => ({
    id, videoId: `video-${id}`, relativePath: `${id}.mkv`, sidecars: [`${id}.nfo`], originalRelativePath: null, sizeBytes: BigInt(1000),
    platform: 'TWITCH',
    video: { title: id, externalId: id, creator: { displayName: 'N' } },
  });
  function fakePrisma(files: unknown[], busyJobs = 0) {
    const prisma = {
      archiveMediaFile: { findMany: vi.fn().mockResolvedValue(files), delete: vi.fn().mockResolvedValue({}) },
      archiveJob: { count: vi.fn().mockResolvedValue(busyJobs) },
      fileOperationAudit: { create: vi.fn().mockResolvedValue({}) },
      archiveDeletedFile: { create: vi.fn().mockResolvedValue({}) },
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn((work: (tx: unknown) => unknown) => work(prisma)),
    };
    return prisma;
  }
  const run = (prisma: ReturnType<typeof fakePrisma>) => forgetFilesDeletedElsewhere(prisma as never, 'TWITCH');

  it('forgets a file Jellyfin removed, sweeps its sidecars, audits it, and keeps the others', async () => {
    library.dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-gone-'));
    await writeFile(path.join(library.dir, 'kept.mkv'), '');
    await writeFile(path.join(library.dir, 'gone.nfo'), '');
    const prisma = fakePrisma([row('kept'), row('gone')]);

    expect(await run(prisma)).toBe(1);

    expect(prisma.archiveMediaFile.delete).toHaveBeenCalledTimes(1);
    expect(prisma.archiveMediaFile.delete).toHaveBeenCalledWith({ where: { id: 'gone' } });
    await expect(stat(path.join(library.dir, 'gone.nfo'))).rejects.toThrow();
    expect(prisma.archiveDeletedFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'FILE', cause: 'OUTSIDE', freedBytes: BigInt(1000), videoId: 'video-gone' }),
    });
    expect(prisma.fileOperationAudit.create.mock.calls[0][0].data).toMatchObject({ username: 'system:twitch-worker', service: 'TWITCH' });
  });

  it('leaves a file alone when a job started on it after the sweep looked', async () => {
    library.dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-gone-'));
    await writeFile(path.join(library.dir, 'kept.mkv'), '');
    const prisma = fakePrisma([row('kept'), row('gone')], 1);

    expect(await run(prisma)).toBe(0);

    expect(prisma.archiveMediaFile.delete).not.toHaveBeenCalled();
    expect(prisma.archiveDeletedFile.create).not.toHaveBeenCalled();
  });

  it('stops at a file whose folder has become a link: that says nothing about the file', async () => {
    library.dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-gone-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'twitch-outside-'));
    await writeFile(path.join(library.dir, 'kept.mkv'), '');
    await writeFile(path.join(library.dir, '.helprr-library'), '');
    await symlink(outside, path.join(library.dir, 'linked'));
    const prisma = fakePrisma([row('kept'), { ...row('moved'), relativePath: 'linked/moved.mkv' }]);

    await expect(run(prisma)).rejects.toThrow(/leads outside the library/);

    expect(prisma.archiveMediaFile.delete).not.toHaveBeenCalled();
    await rm(outside, { recursive: true, force: true });
  });

  it('never writes the marker through a link', async () => {
    library.dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-gone-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'twitch-outside-'));
    await writeFile(path.join(outside, 'precious'), 'not ours');
    await writeFile(path.join(library.dir, 'kept.mkv'), '');
    await symlink(path.join(outside, 'precious'), path.join(library.dir, '.helprr-library'));

    await run(fakePrisma([row('kept')])).catch(() => undefined);

    expect(await readFile(path.join(outside, 'precious'), 'utf8')).toBe('not ours');
    await rm(outside, { recursive: true, force: true });
  });

  it.each([[['a', 'b']], [['a']]])('forgets nothing on a folder with no marker, as on an unmounted disk: %j', async (ids) => {
    library.dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-unmounted-'));
    const prisma = fakePrisma(ids.map(row));

    expect(await run(prisma)).toBe(0);
    expect(prisma.archiveMediaFile.delete).not.toHaveBeenCalled();
  });

  it('forgets the last file once the marker proves this is the real library', async () => {
    library.dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-last-'));
    await writeFile(path.join(library.dir, '.helprr-library'), '');
    const prisma = fakePrisma([row('last')]);

    expect(await run(prisma)).toBe(1);
  });

  it('treats a read error as unknown, and removes nothing', async () => {
    library.dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-eio-'));
    await writeFile(path.join(library.dir, 'kept.mkv'), '');
    await writeFile(path.join(library.dir, '.helprr-library'), '');
    await writeFile(path.join(library.dir, 'loop'), '');
    await writeFile(path.join(library.dir, 'bad.nfo'), '');
    const prisma = fakePrisma([row('kept'), { ...row('bad'), relativePath: 'loop/not-a-folder.mkv' }]);

    await expect(run(prisma)).rejects.toThrow(/leads outside the library/);

    expect(prisma.archiveMediaFile.delete).not.toHaveBeenCalled();
    expect(await stat(path.join(library.dir, 'bad.nfo'))).toBeTruthy();
  });

  it('keeps the record when a folder cannot be read: the file may still be there', async () => {
    library.dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-locked-'));
    await writeFile(path.join(library.dir, '.helprr-library'), '');
    await writeFile(path.join(library.dir, 'kept.mkv'), '');
    await mkdir(path.join(library.dir, 'locked'));
    await writeFile(path.join(library.dir, 'locked/sidecar.nfo'), '');
    await chmod(path.join(library.dir, 'locked'), 0o000);
    const prisma = fakePrisma([row('kept'), { ...row('gone'), relativePath: 'gone.mkv', sidecars: ['locked/sidecar.nfo'] }]);

    await expect(run(prisma)).rejects.toThrow(/EACCES/);

    expect(prisma.archiveMediaFile.delete).not.toHaveBeenCalled();
    await chmod(path.join(library.dir, 'locked'), 0o755);
  });

  it('refuses a sidecar reached through a folder linked out of the library', async () => {
    library.dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-link-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'twitch-outside-'));
    await writeFile(path.join(outside, 'victim.nfo'), 'keep');
    await symlink(outside, path.join(library.dir, 'linked'));
    await writeFile(path.join(library.dir, 'kept.mkv'), '');
    const prisma = fakePrisma([row('kept'), { ...row('gone'), relativePath: 'linked/gone.mkv', sidecars: ['linked/victim.nfo'] }]);

    await expect(run(prisma)).rejects.toThrow(/outside the library/);

    expect(await stat(path.join(outside, 'victim.nfo'))).toBeTruthy();
    expect(prisma.archiveMediaFile.delete).not.toHaveBeenCalled();
    await rm(outside, { recursive: true, force: true });
  });

  it('skips a file with a job in progress', async () => {
    library.dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-busy-'));
    const prisma = fakePrisma([]);
    await run(prisma);
    expect(prisma.archiveMediaFile.findMany.mock.calls[0][0].where.jobs.none.state.in).toContain('RUNNING');
  });
});
