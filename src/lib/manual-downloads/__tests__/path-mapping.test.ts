import { describe, expect, it } from 'vitest';
import { applyMapping, arrPathCandidates, joinPath, qbittorrentHostInArr, samePath, splitPath } from '../path-mapping';

const docker = { host: 'host.docker.internal', remotePath: '/mnt/exos22/', localPath: '/data/' };

describe('where a qBittorrent path is on Arr\'s side', () => {
  it('tries the remote path mapping first, then the same path', () => {
    expect(arrPathCandidates('/mnt/exos22/Downloads/Film/a.mkv', [docker], 'host.docker.internal')).toEqual([
      { path: '/data/Downloads/Film/a.mkv', mapping: { host: 'host.docker.internal', remotePath: '/mnt/exos22/', localPath: '/data/' } },
      { path: '/mnt/exos22/Downloads/Film/a.mkv', mapping: null },
    ]);
  });

  it('prefers the longest matching remote path', () => {
    const broad = { host: 'host.docker.internal', remotePath: '/mnt', localPath: '/m' };
    expect(arrPathCandidates('/mnt/exos22/Downloads/a.mkv', [broad, docker], 'host.docker.internal').map((candidate) => candidate.path)).toEqual([
      '/data/Downloads/a.mkv', '/m/exos22/Downloads/a.mkv', '/mnt/exos22/Downloads/a.mkv',
    ]);
  });

  it('matches whole folder names only, and offers the path unchanged without a mapping', () => {
    expect(arrPathCandidates('/mnt/exos22x/a.mkv', [docker], 'host.docker.internal')).toEqual([{ path: '/mnt/exos22x/a.mkv', mapping: null }]);
    expect(arrPathCandidates('/downloads/a.mkv', [], 'host.docker.internal')).toEqual([{ path: '/downloads/a.mkv', mapping: null }]);
  });

  it('maps a folder named exactly by the mapping', () => {
    expect(arrPathCandidates('/mnt/exos22', [docker], 'host.docker.internal')[0].path).toBe('/data/');
  });

  it('handles qBittorrent on Windows with Arr on Linux, ignoring case', () => {
    const mapping = { host: 'win', remotePath: 'd:\\downloads\\', localPath: '/downloads/' };
    expect(arrPathCandidates('D:\\Downloads\\Film\\a.mkv', [mapping], 'win')[0].path).toBe('/downloads/Film/a.mkv');
  });

  it('handles qBittorrent on Linux with Arr on Windows', () => {
    const mapping = { host: 'nas', remotePath: '/downloads/', localPath: 'Z:\\Downloads\\' };
    expect(arrPathCandidates('/downloads/Film/a.mkv', [mapping], 'NAS')[0].path).toBe('Z:\\Downloads\\Film\\a.mkv');
  });

  it("uses only qBittorrent's host's mappings: another client's /downloads is another tree", () => {
    const other = { host: 'seedbox', remotePath: '/mnt/exos22/', localPath: '/seedbox/' };
    expect(arrPathCandidates('/mnt/exos22/Downloads/a.mkv', [other, docker], 'host.docker.internal').map((candidate) => candidate.path)).toEqual([
      '/data/Downloads/a.mkv', '/mnt/exos22/Downloads/a.mkv',
    ]);
    // Without a known host no mapping can be trusted to be qBittorrent's.
    expect(arrPathCandidates('/mnt/exos22/Downloads/a.mkv', [docker], null)).toEqual([{ path: '/mnt/exos22/Downloads/a.mkv', mapping: null }]);
  });

  it("finds the host Arr knows Helprr's qBittorrent by", () => {
    const qbit = (host: string, port: number) => ({ id: 1, name: 'q', enable: true, protocol: 'torrent', priority: 1, implementation: 'QBittorrent', fields: [{ name: 'host', value: host }, { name: 'port', value: port }] });
    const transmission = { id: 9, name: 't', enable: true, protocol: 'torrent', priority: 1, implementation: 'Transmission', fields: [{ name: 'host', value: 'tr' }] };
    expect(qbittorrentHostInArr([qbit('host.docker.internal', 8080), transmission], 'http://192.168.1.5:8080')).toEqual({ host: 'host.docker.internal', ambiguous: false });
    expect(qbittorrentHostInArr([qbit('qbit-a', 8080), qbit('QBIT-B', 8080)], 'http://qbit-b:8080/')).toEqual({ host: 'QBIT-B', ambiguous: false });
    expect(qbittorrentHostInArr([qbit('qbit-a', 8080), qbit('qbit-b', 8080)], 'http://elsewhere:8080')).toEqual({ host: null, ambiguous: true });
    expect(qbittorrentHostInArr([transmission], 'http://qbit:8080')).toEqual({ host: null, ambiguous: false });
  });

  it('tells files apart by case except on Windows', () => {
    expect(samePath('/data/Show/a.mkv', '/data/Show/A.mkv')).toBe(false);
    expect(samePath('/data/Show/a.mkv', '/data/Show/a.mkv')).toBe(true);
    expect(samePath('D:\\Show\\a.mkv', 'd:/show/A.mkv')).toBe(true);
    expect(samePath('/data/Cafe\u0301.mkv', '/data/Caf\u00e9.mkv')).toBe(true);
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
