import { describe, expect, it } from 'vitest';
import { applyMapping, arrPathCandidates, joinPath, splitPath } from '../path-mapping';

const docker = { host: 'host.docker.internal', remotePath: '/mnt/exos22/', localPath: '/data/' };

describe('where a qBittorrent path is on Arr\'s side', () => {
  it('tries the remote path mapping first, then the same path', () => {
    expect(arrPathCandidates('/mnt/exos22/Downloads/Film/a.mkv', [docker])).toEqual([
      { path: '/data/Downloads/Film/a.mkv', mapping: { remotePath: '/mnt/exos22/', localPath: '/data/' } },
      { path: '/mnt/exos22/Downloads/Film/a.mkv', mapping: null },
    ]);
  });

  it('prefers the longest matching remote path', () => {
    const broad = { host: 'nas', remotePath: '/mnt', localPath: '/m' };
    expect(arrPathCandidates('/mnt/exos22/Downloads/a.mkv', [broad, docker]).map((candidate) => candidate.path)).toEqual([
      '/data/Downloads/a.mkv', '/m/exos22/Downloads/a.mkv', '/mnt/exos22/Downloads/a.mkv',
    ]);
  });

  it('matches whole folder names only, and offers the path unchanged without a mapping', () => {
    expect(arrPathCandidates('/mnt/exos22x/a.mkv', [docker])).toEqual([{ path: '/mnt/exos22x/a.mkv', mapping: null }]);
    expect(arrPathCandidates('/downloads/a.mkv', [])).toEqual([{ path: '/downloads/a.mkv', mapping: null }]);
  });

  it('maps a folder named exactly by the mapping', () => {
    expect(arrPathCandidates('/mnt/exos22', [docker])[0].path).toBe('/data/');
  });

  it('handles qBittorrent on Windows with Arr on Linux, ignoring case', () => {
    const mapping = { host: 'win', remotePath: 'd:\\downloads\\', localPath: '/downloads/' };
    expect(arrPathCandidates('D:\\Downloads\\Film\\a.mkv', [mapping])[0].path).toBe('/downloads/Film/a.mkv');
  });

  it('handles qBittorrent on Linux with Arr on Windows', () => {
    const mapping = { host: 'nas', remotePath: '/downloads/', localPath: 'Z:\\Downloads\\' };
    expect(arrPathCandidates('/downloads/Film/a.mkv', [mapping])[0].path).toBe('Z:\\Downloads\\Film\\a.mkv');
  });

  it('applies a chosen mapping the same way to every file', () => {
    expect(applyMapping('/mnt/exos22/Downloads/Film/b.srt', { remotePath: '/mnt/exos22/', localPath: '/data/' })).toBe('/data/Downloads/Film/b.srt');
    expect(applyMapping('/elsewhere/b.srt', { remotePath: '/mnt/exos22/', localPath: '/data/' })).toBe('/elsewhere/b.srt');
    expect(applyMapping('/same/b.srt', null)).toBe('/same/b.srt');
  });

  it('joins and splits in the folder\'s own style', () => {
    expect(joinPath('/mnt/exos22/Downloads/', 'Film/a.mkv')).toBe('/mnt/exos22/Downloads/Film/a.mkv');
    expect(joinPath('D:\\Downloads', 'Film/a.mkv')).toBe('D:\\Downloads\\Film\\a.mkv');
    expect(splitPath('/data/Downloads/Film/a.mkv')).toEqual({ folder: '/data/Downloads/Film/', name: 'a.mkv' });
    expect(splitPath('Z:\\Downloads\\a.mkv')).toEqual({ folder: 'Z:\\Downloads\\', name: 'a.mkv' });
  });
});
