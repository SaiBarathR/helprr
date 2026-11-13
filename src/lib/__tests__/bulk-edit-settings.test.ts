import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The bulk editor's "More" fields: per-service field parsing, per-instance value
 * checks, the capability/admin gates, the audited root-folder move, and the bulk
 * Organize (rename) commands.
 */

const mocks = vi.hoisted(() => {
  const arr = () => ({
    getQualityProfiles: vi.fn(),
    getRootFolders: vi.fn(),
    getMetadataProfiles: vi.fn(),
    getTags: vi.fn(),
    createTag: vi.fn(),
    seriesEditor: vi.fn(),
    movieEditor: vi.fn(),
    artistEditor: vi.fn(),
    renameSeries: vi.fn(),
    renameMovies: vi.fn(),
    renameArtists: vi.fn(),
  });
  return {
    requireAuth: vi.fn(),
    requireUserCapability: vi.fn(),
    getCurrentUser: vi.fn(),
    resolveConnection: vi.fn(),
    runWithOperationAudit: vi.fn(),
    getSonarrClient: vi.fn(),
    sonarr: arr(),
    radarr: arr(),
    lidarr: arr(),
  };
});

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.requireAuth,
  requireUserCapability: mocks.requireUserCapability,
  // The Lidarr command route asks for activity.manage and music.view together.
  requireUserAllCapabilities: mocks.requireUserCapability,
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock('@/lib/arr-instances', () => ({ resolveConnection: mocks.resolveConnection }));
vi.mock('@/lib/service-connection-secrets', () => ({ getConnectionHeaders: () => ({}) }));
vi.mock('@/lib/sonarr-client', () => ({ SonarrClient: class { constructor() { return mocks.sonarr; } } }));
vi.mock('@/lib/radarr-client', () => ({ RadarrClient: class { constructor() { return mocks.radarr; } } }));
vi.mock('@/lib/lidarr-client', () => ({ LidarrClient: class { constructor() { return mocks.lidarr; } } }));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClient: mocks.getSonarrClient,
  getRadarrClient: async () => mocks.radarr,
  getLidarrClient: async () => mocks.lidarr,
}));
vi.mock('@/lib/cache/tagged-library', () => ({ invalidateTaggedLibrary: vi.fn() }));
vi.mock('@/lib/cache/reference-labels', () => ({ invalidateReferenceLabels: vi.fn() }));
vi.mock('@/lib/file-audit', () => ({ runWithOperationAudit: mocks.runWithOperationAudit }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/api-error', () => ({
  upstreamErrorResponse: () => new Response(JSON.stringify({ error: 'upstream' }), { status: 502 }),
}));

import { CAPABILITIES } from '@/lib/capabilities';
import { MAX_BULK_EDIT_IDS, parseBulkEditBody } from '@/lib/bulk-editor';
import { PUT as sonarrEditor } from '@/app/api/sonarr/editor/route';
import { PUT as radarrEditor } from '@/app/api/radarr/editor/route';
import { PUT as lidarrEditor } from '@/app/api/lidarr/editor/route';
import { POST as sonarrCommand } from '@/app/api/sonarr/command/route';
import { POST as radarrCommand } from '@/app/api/radarr/command/route';
import { POST as lidarrCommand } from '@/app/api/lidarr/command/route';

type Handler = (request: NextRequest) => Promise<Response>;

const admin = { id: 'admin-1', username: 'owner', role: 'admin', template: 'admin', permissions: {} };
const member = (permissions: Record<string, boolean> = {}) => ({
  id: 'member-1', username: 'member', role: 'member', template: 'member', permissions,
});

function call(handler: Handler, path: string, method: string, body: unknown) {
  return handler(new NextRequest(`http://helprr.test${path}`, { method, body: JSON.stringify(body) }));
}

const services = [
  {
    svc: 'sonarr', SVC: 'SONARR', handler: sonarrEditor as Handler, client: mocks.sonarr, editor: mocks.sonarr.seriesEditor,
    idKey: 'seriesIds', target: 'series', changePath: 'series.changePath',
  },
  {
    svc: 'radarr', SVC: 'RADARR', handler: radarrEditor as Handler, client: mocks.radarr, editor: mocks.radarr.movieEditor,
    idKey: 'movieIds', target: 'movie', changePath: 'movies.changePath',
  },
  {
    svc: 'lidarr', SVC: 'LIDARR', handler: lidarrEditor as Handler, client: mocks.lidarr, editor: mocks.lidarr.artistEditor,
    idKey: 'artistIds', target: 'artist', changePath: 'music.changePath',
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(null);
  mocks.getCurrentUser.mockResolvedValue(admin);
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: admin });
  mocks.resolveConnection.mockImplementation(async (_type: string, id?: string) => ({ id: id ?? 'default', url: 'http://arr', apiKey: 'k' }));
  mocks.runWithOperationAudit.mockImplementation(async (_input: unknown, op: () => Promise<unknown>) => op());
  mocks.getSonarrClient.mockResolvedValue(mocks.sonarr);
  for (const client of [mocks.sonarr, mocks.radarr, mocks.lidarr]) {
    client.getQualityProfiles.mockResolvedValue([{ id: 1, name: 'HD' }, { id: 4, name: 'Any' }]);
    client.getMetadataProfiles.mockResolvedValue([{ id: 2, name: 'Standard' }]);
    client.getRootFolders.mockResolvedValue([{ id: 1, path: '/media/a' }, { id: 2, path: '/media/b' }]);
    for (const fn of [client.seriesEditor, client.movieEditor, client.artistEditor]) fn.mockResolvedValue([]);
    for (const fn of [client.renameSeries, client.renameMovies, client.renameArtists]) fn.mockResolvedValue({ id: 900 });
  }
});

describe('parseBulkEditBody settings fields', () => {
  it('drops duplicate ids', () => {
    expect(parseBulkEditBody({ ids: [3, 3, 5, 3], monitored: true }, 'sonarr')).toEqual({ ids: [3, 5], monitored: true });
  });

  it('caps the ids in one request', () => {
    const ids = Array.from({ length: MAX_BULK_EDIT_IDS }, (_, i) => i + 1);
    expect(parseBulkEditBody({ ids, monitored: true }, 'radarr')).toMatchObject({ ids });
    expect(parseBulkEditBody({ ids: [...ids, MAX_BULK_EDIT_IDS + 1], monitored: true }, 'radarr'))
      .toEqual({ error: `ids must list at most ${MAX_BULK_EDIT_IDS} items` });
  });

  it('accepts each service its own fields', () => {
    expect(parseBulkEditBody({
      ids: [1], qualityProfileId: 4, rootFolderPath: '/m', moveFiles: true,
      seriesType: 'anime', seasonFolder: false, monitorNewItems: 'none',
    }, 'sonarr')).toEqual({
      ids: [1], qualityProfileId: 4, rootFolderPath: '/m', moveFiles: true,
      seriesType: 'anime', seasonFolder: false, monitorNewItems: 'none',
    });
    expect(parseBulkEditBody({ ids: [1], minimumAvailability: 'inCinemas' }, 'radarr'))
      .toEqual({ ids: [1], minimumAvailability: 'inCinemas' });
    expect(parseBulkEditBody({ ids: [1], metadataProfileId: 2, monitorNewItems: 'all' }, 'lidarr'))
      .toEqual({ ids: [1], metadataProfileId: 2, monitorNewItems: 'all' });
  });

  it.each([
    [{ ids: [1], minimumAvailability: 'released' }, 'sonarr', 'not a sonarr'],
    [{ ids: [1], seriesType: 'anime' }, 'radarr', 'not a radarr'],
    [{ ids: [1], seasonFolder: true }, 'lidarr', 'not a lidarr'],
    [{ ids: [1], metadataProfileId: 2 }, 'sonarr', 'not a sonarr'],
    [{ ids: [1], monitorNewItems: 'all' }, 'radarr', 'not a radarr'],
    [{ ids: [1], qualityProfileId: 0 }, 'sonarr', 'qualityProfileId'],
    [{ ids: [1], qualityProfileId: 1.5 }, 'radarr', 'qualityProfileId'],
    [{ ids: [1], metadataProfileId: 'x' }, 'lidarr', 'metadataProfileId'],
    [{ ids: [1], qualityProfileId: '4' }, 'sonarr', 'qualityProfileId'],
    [{ ids: [1], qualityProfileId: true }, 'radarr', 'qualityProfileId'],
    [{ ids: [1], rootFolderPath: '  ' }, 'sonarr', 'rootFolderPath'],
    [{ ids: [1], rootFolderPath: 7 }, 'radarr', 'rootFolderPath'],
    [{ ids: [1], moveFiles: true }, 'sonarr', 'moveFiles requires rootFolderPath'],
    [{ ids: [1], rootFolderPath: '/m', moveFiles: 'yes' }, 'lidarr', 'moveFiles must be a boolean'],
    [{ ids: [1], seriesType: 'cartoon' }, 'sonarr', 'seriesType'],
    [{ ids: [1], seasonFolder: 'on' }, 'sonarr', 'seasonFolder'],
    [{ ids: [1], monitorNewItems: 'future' }, 'lidarr', 'monitorNewItems'],
    [{ ids: [1], minimumAvailability: 'tba' }, 'radarr', 'minimumAvailability'],
    [{ ids: [1] }, 'sonarr', 'Nothing to update'],
  ] as const)('rejects %j for %s', (body, svc, message) => {
    const parsed = parseBulkEditBody(body, svc);
    expect(parsed).toHaveProperty('error');
    expect((parsed as { error: string }).error).toContain(message);
  });
});

describe.each(services)('PUT /api/$svc/editor settings', ({ svc, SVC, handler, client, editor, idKey, target, changePath }) => {
  const path = `/api/${svc}/editor?instanceId=${svc}-2`;

  it('checks the quality profile against the selected instance before writing', async () => {
    const ok = await call(handler, path, 'PUT', { ids: [3, 5], qualityProfileId: 4 });
    expect(ok.status).toBe(200);
    expect(mocks.resolveConnection).toHaveBeenCalledWith(SVC, `${svc}-2`);
    expect(editor).toHaveBeenCalledWith(expect.objectContaining({ [idKey]: [3, 5], qualityProfileId: 4 }));

    editor.mockClear();
    const bad = await call(handler, path, 'PUT', { ids: [3], qualityProfileId: 99 });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Quality profile 99 does not exist on this instance' });
    expect(editor).not.toHaveBeenCalled();
  });

  it('rejects a root folder that is not on the instance, without an audit row', async () => {
    const res = await call(handler, path, 'PUT', { ids: [3], rootFolderPath: '/media/other', moveFiles: true });
    expect(res.status).toBe(400);
    expect(client.getRootFolders).toHaveBeenCalled();
    expect(editor).not.toHaveBeenCalled();
    expect(mocks.runWithOperationAudit).not.toHaveBeenCalled();
  });

  it('moves files through the operation audit, attributed to the user and instance', async () => {
    const res = await call(handler, path, 'PUT', { ids: [3, 5], rootFolderPath: '/media/b', moveFiles: true });
    expect(res.status).toBe(200);
    expect(mocks.runWithOperationAudit).toHaveBeenCalledTimes(1);
    expect(mocks.runWithOperationAudit.mock.calls[0][0]).toEqual({
      user: admin,
      service: SVC,
      instanceId: `${svc}-2`,
      operation: 'MOVE_MEDIA',
      targetType: target,
      targetId: null,
      targetTitle: expect.stringMatching(/^2 /),
      itemCount: 2,
      details: { targetIds: [3, 5], rootFolderPath: '/media/b', moveFiles: true, bulk: true },
    });
    expect(editor).toHaveBeenCalledWith(expect.objectContaining({
      [idKey]: [3, 5], rootFolderPath: '/media/b', moveFiles: true,
    }));
  });

  it('audits a root-folder change that keeps the files where they are', async () => {
    await call(handler, path, 'PUT', { ids: [3], rootFolderPath: '/media/a', moveFiles: false });
    expect(mocks.runWithOperationAudit.mock.calls[0][0]).toMatchObject({
      targetId: 3, itemCount: 1, details: { moveFiles: false },
    });
  });

  it('records the resolved instance when the request names none', async () => {
    await call(handler, `/api/${svc}/editor`, 'PUT', { ids: [3], rootFolderPath: '/media/a', moveFiles: true });
    expect(mocks.runWithOperationAudit.mock.calls[0][0]).toMatchObject({ instanceId: 'default' });
  });

  it('does not audit an edit that leaves the root folder alone', async () => {
    await call(handler, path, 'PUT', { ids: [3], qualityProfileId: 1 });
    expect(mocks.runWithOperationAudit).not.toHaveBeenCalled();
  });

  it(`lets a member with ${changePath} change the root folder`, async () => {
    mocks.getCurrentUser.mockResolvedValue(member({ [changePath]: true }));
    const res = await call(handler, path, 'PUT', { ids: [3], rootFolderPath: '/media/b', moveFiles: true });
    expect(res.status).toBe(200);
    expect(mocks.runWithOperationAudit.mock.calls[0][0]).toMatchObject({ user: { id: 'member-1' } });
  });

  it(`forbids a member without ${changePath} from changing the root folder`, async () => {
    mocks.getCurrentUser.mockResolvedValue(member());
    const res = await call(handler, path, 'PUT', { ids: [3], rootFolderPath: '/media/b' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: `Forbidden: you cannot change ${changePath}` });
    expect(editor).not.toHaveBeenCalled();
    expect(mocks.resolveConnection).not.toHaveBeenCalled();
  });

  it('keeps the quality profile admin-only, even with every library capability', async () => {
    mocks.getCurrentUser.mockResolvedValue(member(Object.fromEntries(CAPABILITIES.map((cap) => [cap, true]))));
    const res = await call(handler, path, 'PUT', { ids: [3], qualityProfileId: 1 });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden: only an admin can change these fields' });
    expect(editor).not.toHaveBeenCalled();
  });
});

describe('admin-only service fields', () => {
  it.each([
    ['sonarr', sonarrEditor, { seriesType: 'anime' }],
    ['sonarr', sonarrEditor, { seasonFolder: true }],
    ['sonarr', sonarrEditor, { monitorNewItems: 'none' }],
    ['radarr', radarrEditor, { minimumAvailability: 'released' }],
    ['lidarr', lidarrEditor, { metadataProfileId: 2 }],
    ['lidarr', lidarrEditor, { monitorNewItems: 'all' }],
  ] as const)('%s %j is forbidden to members', async (svc, handler, field) => {
    mocks.getCurrentUser.mockResolvedValue(member({ 'series.changePath': true, 'movies.changePath': true, 'music.changePath': true }));
    const res = await call(handler as Handler, `/api/${svc}/editor`, 'PUT', { ids: [1], ...field });
    expect(res.status).toBe(403);
  });

  it('passes Sonarr series type, season folder and monitor new seasons through for an admin', async () => {
    const res = await call(sonarrEditor as Handler, '/api/sonarr/editor', 'PUT', {
      ids: [1], seriesType: 'daily', seasonFolder: false, monitorNewItems: 'none',
    });
    expect(res.status).toBe(200);
    expect(mocks.sonarr.seriesEditor).toHaveBeenCalledWith(expect.objectContaining({
      seriesIds: [1], seriesType: 'daily', seasonFolder: false, monitorNewItems: 'none',
    }));
  });

  it('passes Radarr minimum availability through for an admin', async () => {
    await call(radarrEditor as Handler, '/api/radarr/editor', 'PUT', { ids: [1], minimumAvailability: 'announced' });
    expect(mocks.radarr.movieEditor).toHaveBeenCalledWith(expect.objectContaining({ movieIds: [1], minimumAvailability: 'announced' }));
  });

  it('checks the Lidarr metadata profile against the instance', async () => {
    const ok = await call(lidarrEditor as Handler, '/api/lidarr/editor', 'PUT', { ids: [1], metadataProfileId: 2, monitorNewItems: 'none' });
    expect(ok.status).toBe(200);
    expect(mocks.lidarr.artistEditor).toHaveBeenCalledWith(expect.objectContaining({
      artistIds: [1], metadataProfileId: 2, monitorNewItems: 'none',
    }));
    const bad = await call(lidarrEditor as Handler, '/api/lidarr/editor', 'PUT', { ids: [1], metadataProfileId: 9 });
    expect(bad.status).toBe(400);
  });

  it('still lets a member with the monitoring capability bulk-monitor', async () => {
    mocks.getCurrentUser.mockResolvedValue(member({ 'series.editMonitoring': true }));
    const res = await call(sonarrEditor as Handler, '/api/sonarr/editor', 'PUT', { ids: [1], monitored: true });
    expect(res.status).toBe(200);
  });
});

describe('bulk Organize commands', () => {
  it('Sonarr RenameSeries renames a list of series', async () => {
    const res = await call(sonarrCommand as Handler, '/api/sonarr/command?instanceId=s-2', 'POST', { name: 'RenameSeries', seriesIds: [3, 5] });
    expect(res.status).toBe(200);
    expect(mocks.getSonarrClient).toHaveBeenCalledWith('s-2');
    expect(mocks.sonarr.renameSeries).toHaveBeenCalledWith([3, 5]);
  });

  it('Sonarr RenameSeries still takes a single seriesId', async () => {
    await call(sonarrCommand as Handler, '/api/sonarr/command', 'POST', { name: 'RenameSeries', seriesId: 7 });
    expect(mocks.sonarr.renameSeries).toHaveBeenCalledWith([7]);
  });

  it.each([
    [sonarrCommand, 'sonarr', { name: 'RenameSeries', seriesIds: [] }, mocks.sonarr.renameSeries],
    [sonarrCommand, 'sonarr', { name: 'RenameSeries' }, mocks.sonarr.renameSeries],
    [radarrCommand, 'radarr', { name: 'RenameMovie', movieIds: [0] }, mocks.radarr.renameMovies],
    [lidarrCommand, 'lidarr', { name: 'RenameArtist', artistIds: 'x' }, mocks.lidarr.renameArtists],
  ] as const)('%#: rejects invalid ids', async (handler, svc, body, rename) => {
    const res = await call(handler as Handler, `/api/${svc}/command`, 'POST', body);
    expect(res.status).toBe(400);
    expect(rename).not.toHaveBeenCalled();
  });

  it('Radarr RenameMovie and Lidarr RenameArtist rename lists', async () => {
    await call(radarrCommand as Handler, '/api/radarr/command', 'POST', { name: 'RenameMovie', movieIds: [4, 4, 6] });
    expect(mocks.radarr.renameMovies).toHaveBeenCalledWith([4, 6]);
    await call(lidarrCommand as Handler, '/api/lidarr/command', 'POST', { name: 'RenameArtist', artistIds: [8, 8] });
    expect(mocks.lidarr.renameArtists).toHaveBeenCalledWith([8]);
  });

  it('requires activity.manage', async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const res = await call(radarrCommand as Handler, '/api/radarr/command', 'POST', { name: 'RenameMovie', movieIds: [4] });
    expect(res.status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('activity.manage');
    expect(mocks.radarr.renameMovies).not.toHaveBeenCalled();
  });
});
