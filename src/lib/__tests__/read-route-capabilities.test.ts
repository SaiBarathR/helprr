import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireCapability: vi.fn(),
  getSonarrClient: vi.fn(),
  getRadarrClient: vi.fn(),
  getLidarrClient: vi.fn(),
  sonarrEpisodes: vi.fn(),
  sonarrRename: vi.fn(),
  sonarrManualImport: vi.fn(),
  radarrHistory: vi.fn(),
  radarrRename: vi.fn(),
  radarrManualImport: vi.fn(),
  lidarrTracks: vi.fn(),
  lidarrRename: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.requireAuth,
  requireCapability: mocks.requireCapability,
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClient: mocks.getSonarrClient,
  getRadarrClient: mocks.getRadarrClient,
  getLidarrClient: mocks.getLidarrClient,
}));

import { GET as manualImportGet } from '@/app/api/activity/manualimport/route';
import { GET as episodesGet } from '@/app/api/sonarr/[id]/episodes/route';
import { GET as movieHistoryGet } from '@/app/api/radarr/history/movie/route';
import { GET as tracksGet } from '@/app/api/lidarr/album/[albumId]/tracks/route';
import { GET as sonarrRenameGet } from '@/app/api/sonarr/rename/route';
import { GET as radarrRenameGet } from '@/app/api/radarr/rename/route';
import { GET as lidarrRenameGet } from '@/app/api/lidarr/rename/route';

type GetCase = {
  name: string;
  capability: string;
  invoke: () => Promise<Response>;
};

const request = (path: string) => new NextRequest(`http://localhost${path}`);

const cases: GetCase[] = [
  {
    name: 'manual import',
    capability: 'activity.manage',
    invoke: () => manualImportGet(request(
      '/api/activity/manualimport?source=sonarr&downloadId=download-1&instanceId=sonarr-hd',
    )),
  },
  {
    name: 'Sonarr episodes',
    capability: 'series.view',
    invoke: () => episodesGet(
      request('/api/sonarr/7/episodes?includeEpisodeFile=true&instanceId=sonarr-hd'),
      { params: Promise.resolve({ id: '7' }) },
    ),
  },
  {
    name: 'Radarr movie history',
    capability: 'movies.view',
    invoke: () => movieHistoryGet(request(
      '/api/radarr/history/movie?movieId=8&instanceId=radarr-4k',
    )),
  },
  {
    name: 'Lidarr album tracks',
    capability: 'music.view',
    invoke: () => tracksGet(
      request('/api/lidarr/album/9/tracks?instanceId=lidarr-lossless'),
      { params: Promise.resolve({ albumId: '9' }) },
    ),
  },
  {
    name: 'Sonarr rename preview',
    capability: 'activity.manage',
    invoke: () => sonarrRenameGet(request(
      '/api/sonarr/rename?seriesId=7&instanceId=sonarr-hd',
    )),
  },
  {
    name: 'Radarr rename preview',
    capability: 'activity.manage',
    invoke: () => radarrRenameGet(request(
      '/api/radarr/rename?movieId=8&instanceId=radarr-4k',
    )),
  },
  {
    name: 'Lidarr rename preview',
    capability: 'activity.manage',
    invoke: () => lidarrRenameGet(request(
      '/api/lidarr/rename?artistId=10&albumId=9&instanceId=lidarr-lossless',
    )),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(null);
  mocks.requireCapability.mockResolvedValue(null);
  mocks.getSonarrClient.mockResolvedValue({
    getEpisodes: mocks.sonarrEpisodes.mockResolvedValue([]),
    getRenamePreview: mocks.sonarrRename.mockResolvedValue([]),
    getManualImport: mocks.sonarrManualImport.mockResolvedValue([]),
  });
  mocks.getRadarrClient.mockResolvedValue({
    getMovieHistory: mocks.radarrHistory.mockResolvedValue([]),
    getRenamePreview: mocks.radarrRename.mockResolvedValue([]),
    getManualImport: mocks.radarrManualImport.mockResolvedValue([]),
  });
  mocks.getLidarrClient.mockResolvedValue({
    getTracks: mocks.lidarrTracks.mockResolvedValue([]),
    getRenamePreview: mocks.lidarrRename.mockResolvedValue([]),
  });
});

describe('sensitive authenticated GET route capabilities', () => {
  it.each(cases)('returns 401 before capability or upstream work: $name', async ({ invoke }) => {
    mocks.requireAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const response = await invoke();

    expect(response.status).toBe(401);
    expect(mocks.requireCapability).not.toHaveBeenCalled();
    expect(mocks.getSonarrClient).not.toHaveBeenCalled();
    expect(mocks.getRadarrClient).not.toHaveBeenCalled();
    expect(mocks.getLidarrClient).not.toHaveBeenCalled();
  });

  it.each(cases)('returns 403 before upstream work when $capability is revoked: $name', async ({
    capability,
    invoke,
  }) => {
    mocks.requireCapability.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );

    const response = await invoke();

    expect(response.status).toBe(403);
    expect(mocks.requireCapability).toHaveBeenCalledWith(capability);
    expect(mocks.getSonarrClient).not.toHaveBeenCalled();
    expect(mocks.getRadarrClient).not.toHaveBeenCalled();
    expect(mocks.getLidarrClient).not.toHaveBeenCalled();
  });

  it.each(cases)('preserves successful access when $capability is granted: $name', async ({
    capability,
    invoke,
  }) => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(mocks.requireCapability).toHaveBeenCalledWith(capability);
  });

  it('preserves selected multi-instance IDs and route parameters', async () => {
    await Promise.all(cases.map(({ invoke }) => invoke()));

    expect(mocks.getSonarrClient).toHaveBeenCalledWith('sonarr-hd');
    expect(mocks.sonarrEpisodes).toHaveBeenCalledWith(7, true);
    expect(mocks.sonarrManualImport).toHaveBeenCalledWith('download-1');
    expect(mocks.sonarrRename).toHaveBeenCalledWith(7);
    expect(mocks.getRadarrClient).toHaveBeenCalledWith('radarr-4k');
    expect(mocks.radarrHistory).toHaveBeenCalledWith(8);
    expect(mocks.radarrRename).toHaveBeenCalledWith(8);
    expect(mocks.getLidarrClient).toHaveBeenCalledWith('lidarr-lossless');
    expect(mocks.lidarrTracks).toHaveBeenCalledWith(9);
    expect(mocks.lidarrRename).toHaveBeenCalledWith(10, 9);
  });
});
