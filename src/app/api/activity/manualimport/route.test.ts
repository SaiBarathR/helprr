import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(), getSonarrClient: vi.fn(), getRadarrClient: vi.fn(),
  list: vi.fn(), submit: vi.fn(), audit: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/service-helpers', () => ({ getSonarrClient: mocks.getSonarrClient, getRadarrClient: mocks.getRadarrClient }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/file-audit', () => ({ recordOperationAudit: mocks.audit }));
vi.mock('@/lib/api-error', () => ({
  upstreamErrorResponse: () => new Response(JSON.stringify({ error: 'upstream' }), { status: 502 }),
}));

import { POST } from './route';
import { POST as sonarrCommand } from '@/app/api/sonarr/command/route';
import { POST as radarrCommand } from '@/app/api/radarr/command/route';

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

// The command routes pass commands straight to the arr. An import sent there
// would skip the path check and the audit row above.
describe('ManualImport through the command routes', () => {
  it.each([
    ['sonarr', sonarrCommand],
    ['radarr', radarrCommand],
  ])('is not a command /api/%s/command accepts', async (service, handler) => {
    const res = await handler(new NextRequest(`http://localhost/api/${service}/command`, {
      method: 'POST', body: JSON.stringify({ name: 'ManualImport', files: [episode('/config/sonarr.db')] }),
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Unknown command: ManualImport' });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
