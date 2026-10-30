import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const library = vi.hoisted(() => ({ dir: '' }));
vi.mock('./env', () => ({
  get LIBRARY_DIR() { return library.dir; },
  ORIGINALS_DIR: '',
  STAGING_DIR: '',
  FFMPEG: '',
  FFPROBE: '',
}));

import { forgetFilesDeletedElsewhere, insideLibrary, repairLibraryModes } from './delete-files';

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

    await repairLibraryModes(library.dir);

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
    id, relativePath: `${id}.mkv`, sidecars: [`${id}.nfo`], originalRelativePath: null,
    video: { title: id, twitchVideoId: id },
  });
  function fakePrisma(files: unknown[]) {
    return {
      twitchMediaFile: { findMany: vi.fn().mockResolvedValue(files), delete: vi.fn().mockResolvedValue({}) },
      fileOperationAudit: { create: vi.fn().mockResolvedValue({}) },
    };
  }
  const run = (prisma: ReturnType<typeof fakePrisma>) => forgetFilesDeletedElsewhere(prisma as never);

  it('forgets a file Jellyfin removed, sweeps its sidecars, audits it, and keeps the others', async () => {
    library.dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-gone-'));
    await writeFile(path.join(library.dir, 'kept.mkv'), '');
    await writeFile(path.join(library.dir, 'gone.nfo'), '');
    const prisma = fakePrisma([row('kept'), row('gone')]);

    expect(await run(prisma)).toBe(1);

    expect(prisma.twitchMediaFile.delete).toHaveBeenCalledTimes(1);
    expect(prisma.twitchMediaFile.delete).toHaveBeenCalledWith({ where: { id: 'gone' } });
    await expect(stat(path.join(library.dir, 'gone.nfo'))).rejects.toThrow();
    expect(prisma.fileOperationAudit.create.mock.calls[0][0].data).toMatchObject({ username: 'system:twitch-worker', service: 'TWITCH' });
  });

  it.each([[['a', 'b']], [['a']]])('forgets nothing on a folder with no marker, as on an unmounted disk: %j', async (ids) => {
    library.dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-unmounted-'));
    const prisma = fakePrisma(ids.map(row));

    expect(await run(prisma)).toBe(0);
    expect(prisma.twitchMediaFile.delete).not.toHaveBeenCalled();
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

    await expect(run(prisma)).rejects.toThrow(/ENOTDIR/);

    expect(prisma.twitchMediaFile.delete).not.toHaveBeenCalled();
    expect(await stat(path.join(library.dir, 'bad.nfo'))).toBeTruthy();
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
    expect(prisma.twitchMediaFile.delete).not.toHaveBeenCalled();
    await rm(outside, { recursive: true, force: true });
  });

  it('skips a file with a job in progress', async () => {
    library.dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-busy-'));
    const prisma = fakePrisma([]);
    await run(prisma);
    expect(prisma.twitchMediaFile.findMany.mock.calls[0][0].where.jobs.none.state.in).toContain('RUNNING');
  });
});
