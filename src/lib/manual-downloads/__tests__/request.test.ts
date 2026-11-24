import { describe, expect, it, vi } from 'vitest';
import { ManualDownloadForbiddenError, ManualDownloadRequestError, readFallbackRequest, readFileDecisions, readManualDownloadRequest } from '../request';

const HASH = '382cc016ff22946008ecddcb0dda820f42b0cd5a';
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP`;

function form(request: unknown, torrent?: Blob) {
  const data = new FormData();
  data.set('request', typeof request === 'string' ? request : JSON.stringify(request));
  if (torrent) data.set('torrent', torrent, 'release.torrent');
  return data;
}
const base = { service: 'RADARR', instanceId: 'r1', externalId: 10331, magnetUrl: MAGNET };

describe('readManualDownloadRequest', () => {
  it('reads a magnet request, naming the release after the magnet by default', async () => {
    const { input, clientRequestId } = await readManualDownloadRequest(form({ ...base, clientRequestId: 'a1b2c3d4-0000', add: { qualityProfileId: 1, rootFolderPath: '/movies' } }));
    expect(input).toEqual(expect.objectContaining({
      service: 'RADARR', instanceId: 'r1', externalId: 10331,
      releaseTitle: 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP',
      add: { qualityProfileId: 1, rootFolderPath: '/movies', tags: [], minimumAvailability: 'released' },
      monitorTarget: false,
    }));
    expect(input.source).toEqual(expect.objectContaining({ kind: 'MAGNET', infoHash: HASH.toUpperCase() }));
    expect(clientRequestId).toBe('a1b2c3d4-0000');
  });

  it('reads an uploaded .torrent file', async () => {
    const pieces = Buffer.alloc(20, 1);
    const info = Buffer.concat([Buffer.from('d6:lengthi1e4:name5:a.mkv12:piece lengthi16384e6:pieces20:'), pieces, Buffer.from('e')]);
    const torrent = Buffer.concat([Buffer.from('d4:info'), info, Buffer.from('e')]);
    const { input } = await readManualDownloadRequest(form({ ...base, magnetUrl: undefined, service: 'SONARR' }, new Blob([torrent])));
    expect(input.source).toEqual(expect.objectContaining({ kind: 'TORRENT_FILE', name: 'a.mkv' }));
    expect(input.add).toBeUndefined();
  });

  it('reads a Prowlarr result by its token only: a magnet or file sent beside it is ignored', async () => {
    const prowlarr = { kind: 'MAGNET' as const, infoHash: 'A'.repeat(40), name: 'From.Prowlarr', magnetUrl: 'magnet:?xt=urn:btih:' + 'a'.repeat(40) };
    const prowlarrSource = vi.fn(async () => prowlarr);
    const authorize = vi.fn();
    const { input } = await readManualDownloadRequest(form({ ...base, prowlarrRelease: 'tok-1', monitorTarget: true }, new Blob(['x'])), { authorize, prowlarrSource });
    expect(authorize).toHaveBeenCalledWith({ service: 'RADARR', monitorTarget: true, prowlarr: true });
    expect(prowlarrSource).toHaveBeenCalledWith('tok-1');
    expect(input.source).toBe(prowlarr);
    expect(input.releaseTitle).toBe('From.Prowlarr');
  });

  it('checks access before it reads a Prowlarr result, and refuses one it cannot read', async () => {
    const prowlarrSource = vi.fn();
    const authorize = () => { throw new ManualDownloadForbiddenError(); };
    await expect(readManualDownloadRequest(form({ ...base, prowlarrRelease: 'tok-1' }), { authorize, prowlarrSource })).rejects.toThrow(ManualDownloadForbiddenError);
    expect(prowlarrSource).not.toHaveBeenCalled();

    await expect(readManualDownloadRequest(form({ ...base, prowlarrRelease: 'tok-1' }))).rejects.toThrow(ManualDownloadRequestError);
    for (const bad of ['', 5, 'x'.repeat(65)]) {
      await expect(readManualDownloadRequest(form({ ...base, prowlarrRelease: bad }), { prowlarrSource })).rejects.toThrow('Invalid release.');
    }
    expect(prowlarrSource).not.toHaveBeenCalled();
  });

  it('defaults Sonarr add options', async () => {
    const { input } = await readManualDownloadRequest(form({ ...base, service: 'SONARR', add: { qualityProfileId: 2, rootFolderPath: '/tv', tags: [3] } }));
    expect(input.add).toEqual({ qualityProfileId: 2, rootFolderPath: '/tv', tags: [3], seriesType: 'standard', seasonFolder: true });
  });

  it('refuses anything it cannot check', async () => {
    const refused = async (request: unknown) => expect(readManualDownloadRequest(form(request))).rejects.toThrow(ManualDownloadRequestError);
    await refused('not json');
    await refused({ ...base, service: 'LIDARR' });
    await refused({ ...base, instanceId: '' });
    await refused({ ...base, externalId: -1 });
    await refused({ ...base, magnetUrl: 'magnet:?dn=no-hash' });
    await refused({ ...base, magnetUrl: undefined });
    await refused({ ...base, downloadClientId: 'one' });
    await refused({ ...base, clientRequestId: 'bad id!' });
    await refused({ ...base, add: { qualityProfileId: 1, rootFolderPath: '/m', minimumAvailability: 'soon' } });
    await refused({ ...base, add: { qualityProfileId: 1, rootFolderPath: '/m', tags: ['x'] } });
  });
});

describe('reading a fallback request', () => {
  const body = { service: 'SONARR', instanceId: 'i1', externalId: 329822, infoHash: '382cc016ff22946008ecddcb0dda820f42b0cd5a', selectedFileIndexes: [3, 0, 3], clientRequestId: 'req-00001' };

  it('takes the torrent by hash and the chosen file indexes, once each', () => {
    expect(readFallbackRequest(body)).toEqual({
      input: { service: 'SONARR', instanceId: 'i1', externalId: 329822, infoHash: '382CC016FF22946008ECDDCB0DDA820F42B0CD5A', selectedFileIndexes: [3, 0], source: 'MAGNET', add: undefined },
      clientRequestId: 'req-00001',
    });
  });

  it('refuses anything else', () => {
    expect(() => readFallbackRequest({ ...body, infoHash: 'xyz' })).toThrow('Invalid torrent.');
    expect(() => readFallbackRequest({ ...body, selectedFileIndexes: [-1] })).toThrow('Invalid file choice.');
    expect(() => readFallbackRequest({ ...body, selectedFileIndexes: '0' })).toThrow('Invalid file choice.');
    expect(() => readFallbackRequest({ ...body, service: 'LIDARR' })).toThrow('Choose Radarr or Sonarr.');
  });

  it('reads per-file decisions strictly', () => {
    expect(readFileDecisions({ files: [{ fileId: 'f0', decision: 'IMPORT', episodeIds: [5] }, { fileId: 'f1', decision: 'IGNORE' }] })).toEqual([
      { fileId: 'f0', decision: 'IMPORT', episodeIds: [5] }, { fileId: 'f1', decision: 'IGNORE', episodeIds: [] },
    ]);
    expect(() => readFileDecisions({ files: [{ fileId: 'f0', decision: 'MOVE' }] })).toThrow('Invalid file decisions.');
    expect(() => readFileDecisions({ files: [{ fileId: 'f0', decision: 'IMPORT', episodeIds: [0] }] })).toThrow('Invalid episodes.');
    expect(() => readFileDecisions({ files: [] })).toThrow('Invalid file decisions.');
  });
});
