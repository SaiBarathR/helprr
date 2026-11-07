import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(), getSonarrClient: vi.fn(), getRadarrClient: vi.fn(), getLidarrClient: vi.fn(),
  list: vi.fn(), submit: vi.fn(), audit: vi.fn(), getAlbum: vi.fn(), releaseTracks: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClient: mocks.getSonarrClient, getRadarrClient: mocks.getRadarrClient, getLidarrClient: mocks.getLidarrClient,
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/file-audit', () => ({ recordOperationAudit: mocks.audit }));
vi.mock('@/lib/api-error', () => ({
  upstreamErrorResponse: () => new Response(JSON.stringify({ error: 'upstream' }), { status: 502 }),
}));

import { GET, POST } from './route';
import { POST as sonarrCommand } from '@/app/api/sonarr/command/route';
import { POST as radarrCommand } from '@/app/api/radarr/command/route';
import { POST as lidarrCommand } from '@/app/api/lidarr/command/route';

const user = { id: 'user-1', username: 'member' };
const DOWNLOAD = 'A1B2C3D4E5F6';
const episode = (path: string, extra: Record<string, unknown> = {}) => ({
  path, seriesId: 47, episodeIds: [101], quality: { quality: { id: 4, name: 'HDTV-720p' } }, downloadId: DOWNLOAD, importMode: 'move', ...extra,
});
const post = (body: unknown, query = '') => POST(new NextRequest(`http://localhost/api/activity/manualimport${query}`, {
  method: 'POST', body: JSON.stringify(body),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user });
  const client = { getManualImport: mocks.list, submitManualImport: mocks.submit };
  mocks.getSonarrClient.mockResolvedValue(client);
  mocks.getRadarrClient.mockResolvedValue(client);
  mocks.getLidarrClient.mockResolvedValue({ ...client, getAlbumById: mocks.getAlbum, getReleaseTracks: mocks.releaseTracks });
  mocks.getAlbum.mockImplementation(async (id: number) => ({ id, artistId: 8, releases: [{ id: 70 + id }, { id: 90 + id }] }));
  mocks.releaseTracks.mockImplementation(async (releaseId: number) => [1, 2, 3].map((n) => ({ id: releaseId * 10 + n })));
  mocks.list.mockResolvedValue([{ path: '/downloads/pack/e01.mkv' }, { path: '/downloads/pack/e02.mkv' }]);
  mocks.submit.mockResolvedValue({ id: 900, name: 'ManualImport' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/activity/manualimport', () => {
  it('requires the activity.manage capability and does nothing without it', async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await post({ source: 'sonarr', files: [episode('/downloads/pack/e01.mkv')] })).status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('activity.manage');
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('imports files the arr lists for the download and records who did it', async () => {
    const files = [episode('/downloads/pack/e01.mkv'), episode('/downloads/pack/e02.mkv', { episodeIds: [102] })];
    const res = await post({ source: 'sonarr', instanceId: 'son-2', title: 'Show S01 1080p', files });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 900, name: 'ManualImport' });
    expect(mocks.getSonarrClient).toHaveBeenCalledWith('son-2');
    expect(mocks.list).toHaveBeenCalledWith(DOWNLOAD);
    expect(mocks.submit).toHaveBeenCalledWith(files);
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith({
      user,
      service: 'SONARR',
      instanceId: 'son-2',
      operation: 'IMPORT',
      targetType: 'series',
      targetId: 47,
      targetTitle: 'Show S01 1080p',
      itemCount: 2,
      details: {
        origin: 'activity',
        downloadId: DOWNLOAD,
        paths: ['/downloads/pack/e01.mkv', '/downloads/pack/e02.mkv'],
        mediaIds: [47],
        commandId: 900,
      },
      startedAt: expect.any(Date),
      success: true,
      errorMessage: null,
    });
  });

  it('routes a movie to Radarr, with the instance from the query taking precedence', async () => {
    const files = [{ path: '/downloads/pack/e01.mkv', movieId: 12, downloadId: DOWNLOAD }];
    const res = await post({ source: 'radarr', instanceId: 'ignored', files }, '?instanceId=rad-1');

    expect(res.status).toBe(200);
    expect(mocks.getRadarrClient).toHaveBeenCalledWith('rad-1');
    expect(mocks.getSonarrClient).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      service: 'RADARR', instanceId: 'rad-1', targetType: 'movie', targetId: 12, targetTitle: `Download ${DOWNLOAD}`,
    }));
  });

  // The arr's ManualImport command moves whatever path it is handed.
  it.each([
    ['a file outside the download', '/config/sonarr.db'],
    ['another title\'s file', '/tv/Other Show/Season 01/e01.mkv'],
    ['a path that only looks alike', '/downloads/pack/../pack/e01.mkv'],
  ])('refuses %s before anything is moved', async (_label, path) => {
    const res = await post({ source: 'sonarr', files: [episode('/downloads/pack/e01.mkv'), episode(path)] });
    expect(res.status).toBe(409);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('refuses a download the arr does not know', async () => {
    mocks.list.mockResolvedValue([]);
    const res = await post({ source: 'sonarr', files: [episode('/downloads/pack/e01.mkv')] });
    expect(res.status).toBe(409);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each([
    ['no files', []],
    ['a file without a download id', [{ path: '/downloads/pack/e01.mkv', seriesId: 47 }]],
    ['a file without a path', [{ downloadId: DOWNLOAD, seriesId: 47 }]],
    ['something that is not an object', ['/downloads/pack/e01.mkv']],
    ['files from two downloads', [episode('/downloads/pack/e01.mkv'), episode('/downloads/pack/e02.mkv', { downloadId: 'OTHER' })]],
    ['more files than one download holds', Array.from({ length: 1001 }, () => episode('/downloads/pack/e01.mkv'))],
  ])('rejects %s without asking the arr anything', async (_label, files) => {
    const res = await post({ source: 'sonarr', files });
    expect(res.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('names no single series for a pack that spans several', async () => {
    const files = [episode('/downloads/pack/e01.mkv'), episode('/downloads/pack/e02.mkv', { seriesId: 48 })];
    await post({ source: 'sonarr', files });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      targetId: null, details: expect.objectContaining({ mediaIds: [47, 48] }),
    }));
  });

  it.each([
    ['fails without a message', () => mocks.submit.mockRejectedValue(new Error(''))],
    ['answers without a command', () => mocks.submit.mockResolvedValue({})],
  ])('does not report an import as queued when the arr %s', async (_label, arrange) => {
    arrange();
    const res = await post({ source: 'sonarr', files: [episode('/downloads/pack/e01.mkv')] });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to submit manual import' });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('records an import the arr refused, and reports the failure', async () => {
    mocks.submit.mockRejectedValue(new Error('Request failed with status code 500'));
    const res = await post({ source: 'sonarr', files: [episode('/downloads/pack/e01.mkv')] });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to submit manual import' });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errorMessage: 'Request failed with status code 500',
      details: expect.objectContaining({ commandId: null }),
    }));
  });
});

// Album 3 by artist 8 has releases 73 and 93; release 73 holds tracks 731-733.
const track = (path: string, extra: Record<string, unknown> = {}) => ({
  path, artistId: 8, albumId: 3, albumReleaseId: 73, trackIds: [731], quality: { quality: { id: 6, name: 'FLAC' } }, downloadId: DOWNLOAD, ...extra,
});

describe('Lidarr manual import', () => {
  beforeEach(() => {
    mocks.list.mockResolvedValue([
      { path: '/downloads/album/01.flac', quality: { quality: { id: 6, name: 'FLAC' } } },
      { path: '/downloads/album/02.flac', quality: { quality: { id: 6, name: 'FLAC' } } },
    ]);
  });

  it('lists a download\'s files from the chosen Lidarr instance', async () => {
    const res = await GET(new NextRequest(`http://localhost/api/activity/manualimport?downloadId=${DOWNLOAD}&source=lidarr&instanceId=lid-2`));
    expect(res.status).toBe(200);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('activity.manage');
    expect(mocks.getLidarrClient).toHaveBeenCalledWith('lid-2');
    expect(mocks.list).toHaveBeenCalledWith(DOWNLOAD);
  });

  it('requires the activity.manage capability and does nothing without it', async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await post({ source: 'lidarr', files: [track('/downloads/album/01.flac')] })).status).toBe(403);
    expect(mocks.getLidarrClient).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('imports files checked against the album, release and tracks, and records who did it', async () => {
    const files = [
      track('/downloads/album/01.flac', { releaseGroup: 'grp', indexerFlags: 0, disableReleaseSwitching: false, injected: '/etc/passwd' }),
      track('/downloads/album/02.flac', { trackIds: [732, 733], quality: undefined }),
    ];
    const res = await post({ source: 'lidarr', instanceId: 'lid-2', title: 'Artist - Album (2024) FLAC', files });

    expect(res.status).toBe(200);
    expect(mocks.getLidarrClient).toHaveBeenCalledWith('lid-2');
    expect(mocks.getSonarrClient).not.toHaveBeenCalled();
    expect(mocks.getAlbum).toHaveBeenCalledExactlyOnceWith(3);
    expect(mocks.releaseTracks).toHaveBeenCalledExactlyOnceWith(73);
    // Only the fields Lidarr's import reads, with the scan's quality where the request had none.
    expect(mocks.submit).toHaveBeenCalledWith([
      { path: '/downloads/album/01.flac', downloadId: DOWNLOAD, artistId: 8, albumId: 3, albumReleaseId: 73, trackIds: [731], quality: { quality: { id: 6, name: 'FLAC' } }, releaseGroup: 'grp', indexerFlags: 0, disableReleaseSwitching: false },
      { path: '/downloads/album/02.flac', downloadId: DOWNLOAD, artistId: 8, albumId: 3, albumReleaseId: 73, trackIds: [732, 733], quality: { quality: { id: 6, name: 'FLAC' } } },
    ], 'auto');
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      user,
      service: 'LIDARR',
      instanceId: 'lid-2',
      operation: 'IMPORT',
      targetType: 'album',
      targetId: 3,
      targetTitle: 'Artist - Album (2024) FLAC',
      itemCount: 2,
      details: {
        origin: 'activity',
        downloadId: DOWNLOAD,
        paths: ['/downloads/album/01.flac', '/downloads/album/02.flac'],
        mediaIds: [3],
        commandId: 900,
      },
      success: true,
    }));
  });

  // Lidarr imports to whatever album, release and tracks it is handed.
  it.each([
    ['an album by another artist', { artistId: 9 }, 'Album 3 is not by the artist given for its files'],
    ['a release of another album', { albumReleaseId: 74 }, 'Release 74 is not a release of album 3'],
    ['a track on another release', { trackIds: [731, 931] }, 'Track id(s) not on release 73: 931'],
  ])('refuses %s before anything is moved', async (_label, extra, error) => {
    const res = await post({ source: 'lidarr', files: [track('/downloads/album/01.flac', extra), track('/downloads/album/02.flac', extra)] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('refuses one album on two releases', async () => {
    const res = await post({ source: 'lidarr', files: [track('/downloads/album/01.flac'), track('/downloads/album/02.flac', { albumReleaseId: 93, trackIds: [931] })] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Files of album 3 must be on one release' });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('refuses an answer for another album than the one asked for', async () => {
    mocks.getAlbum.mockResolvedValue({});
    const res = await post({ source: 'lidarr', files: [track('/downloads/album/01.flac', { artistId: 9 })] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Lidarr answered album 3 with another album' });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('refuses the same file twice, so it cannot land in two albums', async () => {
    const files = [track('/downloads/album/01.flac'), track('/downloads/album/01.flac', { albumId: 4, albumReleaseId: 74, trackIds: [741] })];
    const res = await post({ source: 'lidarr', files });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Each file can be imported once' });
    expect(mocks.getLidarrClient).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('refuses an album Lidarr no longer has, saying so', async () => {
    mocks.getAlbum.mockRejectedValue(Object.assign(new Error('Not Found'), { isAxiosError: true, response: { status: 404 } }));
    const res = await post({ source: 'lidarr', files: [track('/downloads/album/01.flac')] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Lidarr no longer has album 3' });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('fails closed when Lidarr cannot be asked about the album', async () => {
    mocks.getAlbum.mockRejectedValue(new Error('timeout'));
    const res = await post({ source: 'lidarr', files: [track('/downloads/album/01.flac')] });
    expect(res.status).toBe(500);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('refuses a file outside the download before checking any album', async () => {
    const res = await post({ source: 'lidarr', files: [track('/music/Other Artist/01.flac')] });
    expect(res.status).toBe(409);
    expect(mocks.getAlbum).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each([
    ['no artist', { artistId: undefined }],
    ['no album', { albumId: 0 }],
    ['no release', { albumReleaseId: 'x' }],
    ['no tracks', { trackIds: [] }],
    ['a track id that is not a number', { trackIds: [731, 'all'] }],
  ])('rejects a file with %s without asking Lidarr anything', async (_label, extra) => {
    const res = await post({ source: 'lidarr', files: [track('/downloads/album/01.flac', extra)] });
    expect(res.status).toBe(400);
    expect(mocks.getLidarrClient).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('names no single album for a download that spans several', async () => {
    const files = [track('/downloads/album/01.flac'), track('/downloads/album/02.flac', { albumId: 4, albumReleaseId: 74, trackIds: [741] })];
    expect((await post({ source: 'lidarr', files })).status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      targetId: null, details: expect.objectContaining({ mediaIds: [3, 4] }),
    }));
  });

  it('records an import Lidarr refused, and reports the failure', async () => {
    mocks.submit.mockRejectedValue(new Error('Request failed with status code 500'));
    const res = await post({ source: 'lidarr', files: [track('/downloads/album/01.flac')] });
    expect(res.status).toBe(500);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ service: 'LIDARR', success: false }));
  });
});

// The command routes pass commands straight to the arr. An import sent there
// would skip the path check and the audit row above.
describe('ManualImport through the command routes', () => {
  it.each([
    ['sonarr', sonarrCommand],
    ['radarr', radarrCommand],
    ['lidarr', lidarrCommand],
  ])('is not a command /api/%s/command accepts', async (service, handler) => {
    const res = await handler(new NextRequest(`http://localhost/api/${service}/command`, {
      method: 'POST', body: JSON.stringify({ name: 'ManualImport', files: [episode('/config/sonarr.db')] }),
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Unknown command: ManualImport' });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
