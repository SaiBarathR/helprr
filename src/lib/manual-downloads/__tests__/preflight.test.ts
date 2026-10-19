import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  active: vi.fn(async () => null as unknown),
  radarr: {} as Record<string, ReturnType<typeof vi.fn>>,
  sonarr: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock('@/lib/arr-instances', () => ({ resolveConnection: mocks.connection }));
vi.mock('@/lib/db', () => ({ prisma: { manualDownload: { findFirst: mocks.active } } }));
vi.mock('@/lib/service-connection-secrets', () => ({ getConnectionHeaders: () => undefined }));
vi.mock('@/lib/radarr-client', () => ({ RadarrClient: class { constructor() { return mocks.radarr; } } }));
vi.mock('@/lib/sonarr-client', () => ({ SonarrClient: class { constructor() { return mocks.sonarr; } } }));

import { defaultDownloadClient, preflightManualDownload, type PreflightInput } from '../preflight';
import { parseMagnet } from '../release-source';

const HASH = '382cc016ff22946008ecddcb0dda820f42b0cd5a';
const magnet = (dn: string) => parseMagnet(`magnet:?xt=urn:btih:${HASH}&dn=${encodeURIComponent(dn)}`);
const quality = (name: string) => ({ quality: { id: 1, name } });
const client = (id: number, extra: Record<string, unknown> = {}) => ({ id, name: `qBit ${id}`, enable: true, protocol: 'torrent', priority: 1, implementation: 'QBittorrent', tags: [], ...extra });
const ADD = { qualityProfileId: 1, rootFolderPath: '/movies', tags: [] };

function arrMock(lookup: unknown[], parse: unknown) {
  return {
    lookupMovie: vi.fn(async () => lookup),
    lookupSeries: vi.fn(async () => lookup),
    getDownloadClients: vi.fn(async () => [client(1)]),
    getHistory: vi.fn(async () => ({ records: [] })),
    parseTitle: vi.fn(async () => parse),
    getQualityProfiles: vi.fn(async () => [{ id: 1, name: 'HD' }]),
    getRootFolders: vi.fn(async () => [{ id: 1, path: '/movies', freeSpace: 1 }]),
    getTags: vi.fn(async () => [{ id: 5, label: 'kids' }]),
  };
}

const movie = { title: 'Night of the Living Dead', year: 1968, tmdbId: 10331 };
const radarrInput = (overrides: Partial<PreflightInput> = {}): PreflightInput => ({
  service: 'RADARR', instanceId: 'r1', externalId: 10331,
  source: magnet('Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP'),
  releaseTitle: 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP',
  add: ADD, ...overrides,
});
const codes = (issues: Array<{ code: string }>) => issues.map((issue) => issue.code);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection.mockResolvedValue({ id: 'r1', label: 'Radarr', url: 'http://radarr', apiKey: 'k', customHeaders: null });
  mocks.active.mockResolvedValue(null);
  delete process.env.ARR_CALLBACK_ORIGIN;
  delete process.env.APP_ORIGIN;
});

describe('Radarr preflight', () => {
  it('passes a new film whose release Radarr reads with the right year and a quality', async () => {
    mocks.radarr = arrMock([movie], { parsedMovieInfo: { year: 1968, quality: quality('Bluray-1080p') } });

    const result = await preflightManualDownload(radarrInput());

    expect(result).toEqual(expect.objectContaining({ ok: true, errors: [] }));
    expect(result.plan).toEqual(expect.objectContaining({
      instance: { id: 'r1', label: 'Radarr' },
      target: { externalId: 10331, title: 'Night of the Living Dead', year: 1968, existingId: null },
      parsed: { quality: 'Bluray-1080p', year: 1968 },
      downloadClient: { id: 1, name: 'qBit 1' },
    }));
    expect(mocks.radarr.getHistory).toHaveBeenCalledWith(1, 1, 'date', 'descending', { downloadId: HASH.toUpperCase(), eventType: 1 });
  });

  it('says what Radarr reads when the release would not map to the film', async () => {
    mocks.radarr = arrMock([movie], { parsedMovieInfo: { year: 1990, quality: quality('Bluray-1080p') } });
    expect(codes((await preflightManualDownload(radarrInput())).errors)).toEqual(['RELEASE_YEAR_MISMATCH']);

    mocks.radarr = arrMock([movie], { parsedMovieInfo: { year: 1990, quality: quality('Bluray-1080p') }, movie: { id: 9, title: 'Other Film', year: 1990 } });
    expect(codes((await preflightManualDownload(radarrInput())).errors)).toEqual(['RELEASE_OTHER_TITLE']);

    // The year agrees, so Radarr maps it by TMDB id before it looks at the title.
    mocks.radarr = arrMock([movie], { parsedMovieInfo: { year: 1968, quality: quality('Bluray-1080p') }, movie: { id: 9, title: 'Other Film', year: 1968 } });
    expect((await preflightManualDownload(radarrInput())).ok).toBe(true);

    mocks.radarr = arrMock([movie], { parsedMovieInfo: { year: 1968, quality: quality('Unknown') } });
    expect(codes((await preflightManualDownload(radarrInput())).errors)).toEqual(['RELEASE_QUALITY_UNKNOWN']);

    mocks.radarr = arrMock([movie], { parsedMovieInfo: null });
    expect(codes((await preflightManualDownload(radarrInput())).errors)).toEqual(['RELEASE_TITLE_UNPARSEABLE']);
  });

  it('checks the add options belong to the instance, and requires them for a new film', async () => {
    mocks.radarr = arrMock([movie], { parsedMovieInfo: { year: 1968, quality: quality('Bluray-1080p') } });
    expect(codes((await preflightManualDownload(radarrInput({ add: undefined }))).errors)).toEqual(['ADD_OPTIONS_REQUIRED']);
    expect(codes((await preflightManualDownload(radarrInput({ add: { qualityProfileId: 7, rootFolderPath: '/elsewhere', tags: [99] } }))).errors))
      .toEqual(['PROFILE_INVALID', 'ROOT_FOLDER_INVALID', 'TAG_INVALID']);
  });

  it('asks for monitoring an existing film that is not monitored', async () => {
    mocks.radarr = arrMock([{ ...movie, id: 15, monitored: false }], { parsedMovieInfo: { year: 1968, quality: quality('Bluray-1080p') }, movie: { id: 15, title: movie.title, year: 1968 } });
    expect(codes((await preflightManualDownload(radarrInput({ add: undefined }))).errors)).toEqual(['TARGET_UNMONITORED']);

    const allowed = await preflightManualDownload(radarrInput({ add: undefined, monitorTarget: true }));
    expect(allowed.ok).toBe(true);
    expect(codes(allowed.warnings)).toEqual(['TARGET_WILL_BE_MONITORED']);
  });

  it('never leaves Radarr to rotate between download clients', async () => {
    mocks.radarr = arrMock([movie], { parsedMovieInfo: { year: 1968, quality: quality('Bluray-1080p') } });
    mocks.radarr.getDownloadClients.mockResolvedValue([client(1), client(2), client(3, { enable: false })]);

    const needsChoice = await preflightManualDownload(radarrInput());
    expect(codes(needsChoice.errors)).toEqual(['DOWNLOAD_CLIENT_REQUIRED']);
    expect(needsChoice.plan.downloadClientChoices.map((dc) => dc.id)).toEqual([1, 2]);

    expect((await preflightManualDownload(radarrInput({ downloadClientId: 2 }))).plan.downloadClient).toEqual({ id: 2, name: 'qBit 2' });
    expect(codes((await preflightManualDownload(radarrInput({ downloadClientId: 3 }))).errors)).toEqual(['DOWNLOAD_CLIENT_INVALID']);
  });

  it('refuses a release already grabbed, or already on its way, and an instance that does not answer', async () => {
    mocks.radarr = arrMock([movie], { parsedMovieInfo: { year: 1968, quality: quality('Bluray-1080p') } });
    mocks.radarr.getHistory.mockResolvedValue({ records: [{ eventType: 'grabbed' }] });
    expect(codes((await preflightManualDownload(radarrInput())).errors)).toEqual(['ALREADY_GRABBED']);

    mocks.radarr.getHistory.mockResolvedValue({ records: [] });
    mocks.active.mockResolvedValue({ id: 'md1', arrItemTitle: movie.title });
    expect(codes((await preflightManualDownload(radarrInput())).errors)).toEqual(['ALREADY_ACTIVE']);

    mocks.active.mockResolvedValue(null);
    mocks.radarr.lookupMovie.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(codes((await preflightManualDownload(radarrInput())).errors)).toEqual(['INSTANCE_UNREACHABLE']);
  });

  it('needs an address Radarr can fetch a .torrent from', async () => {
    mocks.radarr = arrMock([movie], { parsedMovieInfo: { year: 1968, quality: quality('Bluray-1080p') } });
    const torrent = { kind: 'TORRENT_FILE' as const, infoHash: HASH.toUpperCase(), name: 'x', private: false, bytes: Buffer.alloc(1) };
    expect(codes((await preflightManualDownload(radarrInput({ source: torrent }))).errors)).toEqual(['CALLBACK_ORIGIN_MISSING']);

    process.env.ARR_CALLBACK_ORIGIN = 'http://192.168.0.10:3050';
    expect((await preflightManualDownload(radarrInput({ source: torrent }))).ok).toBe(true);
  });
});

describe('Sonarr preflight', () => {
  const series = { title: 'Classroom of the Elite', year: 2017, tvdbId: 329822 };
  const sonarrInput = (overrides: Partial<PreflightInput> = {}): PreflightInput => ({
    service: 'SONARR', instanceId: 's1', externalId: 329822,
    source: magnet('Classroom.of.the.Elite.S01E02.1080p.WEB.x264-GRP'),
    releaseTitle: 'Classroom.of.the.Elite.S01E02.1080p.WEB.x264-GRP',
    ...overrides,
  });
  const parsed = { seasonNumber: 1, episodeNumbers: [2], fullSeason: false, quality: quality('WEBDL-1080p') };
  const episode = { id: 23, seasonNumber: 1, episodeNumber: 2, monitored: true, episodeFileId: 0 };

  beforeEach(() => {
    mocks.connection.mockResolvedValue({ id: 's1', label: 'Sonarr', url: 'http://sonarr', apiKey: 'k', customHeaders: null });
  });

  it('lists the episodes an existing series release covers', async () => {
    mocks.sonarr = arrMock([{ ...series, id: 3, monitored: true }], { parsedEpisodeInfo: parsed, series: { id: 3, title: series.title, monitored: true }, episodes: [episode] });

    const result = await preflightManualDownload(sonarrInput());

    expect(result.ok).toBe(true);
    expect(result.plan.episodes).toEqual([{ id: 23, seasonNumber: 1, episodeNumber: 2, monitored: true, hasFile: false }]);
    expect(result.plan.parsed).toEqual({ quality: 'WEBDL-1080p', seasonNumber: 1, episodeNumbers: [2], fullSeason: false });
  });

  it('refuses a release Sonarr reads as another series, or without episodes', async () => {
    mocks.sonarr = arrMock([{ ...series, id: 3, monitored: true }], { parsedEpisodeInfo: parsed, series: { id: 8, title: 'Another Show', monitored: true }, episodes: [] });
    expect(codes((await preflightManualDownload(sonarrInput())).errors)).toEqual(['RELEASE_OTHER_TITLE']);

    mocks.sonarr = arrMock([{ ...series, id: 3, monitored: true }], { parsedEpisodeInfo: { quality: quality('WEBDL-1080p'), episodeNumbers: [] } });
    expect(codes((await preflightManualDownload(sonarrInput())).errors)).toEqual(['RELEASE_NO_EPISODES']);
  });

  it('asks for monitoring the episodes the release covers', async () => {
    mocks.sonarr = arrMock([{ ...series, id: 3, monitored: true }], { parsedEpisodeInfo: parsed, series: { id: 3, title: series.title, monitored: true }, episodes: [{ ...episode, monitored: false }] });
    const refused = await preflightManualDownload(sonarrInput());
    expect(codes(refused.errors)).toEqual(['TARGET_UNMONITORED']);
    expect(refused.errors[0].message).toContain('S01E02');

    expect(codes((await preflightManualDownload(sonarrInput({ monitorTarget: true }))).warnings)).toEqual(['TARGET_WILL_BE_MONITORED']);
  });

  it('checks the episodes of a new series once it is added', async () => {
    mocks.sonarr = arrMock([series], { parsedEpisodeInfo: parsed, series: null });
    mocks.sonarr.getRootFolders.mockResolvedValue([{ id: 1, path: '/tv', freeSpace: 1 }]);

    const result = await preflightManualDownload(sonarrInput({ add: { qualityProfileId: 1, rootFolderPath: '/tv', tags: [], seriesType: 'standard', seasonFolder: true } }));

    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).toEqual(['EPISODES_CHECKED_AFTER_ADD']);
  });
});

describe('Sonarr matching an existing series by its TVDB id', () => {
  it('still checks that the series is monitored', async () => {
    mocks.connection.mockResolvedValue({ id: 's1', label: 'Sonarr', url: 'http://sonarr', apiKey: 'k', customHeaders: null });
    mocks.sonarr = arrMock([{ title: 'Classroom of the Elite', year: 2017, tvdbId: 329822, id: 3, monitored: false }], { parsedEpisodeInfo: { seasonNumber: 1, episodeNumbers: [2], quality: quality('WEBDL-1080p') }, series: null });
    const input = { service: 'SONARR' as const, instanceId: 's1', externalId: 329822, source: magnet('Youkoso.S01E02.1080p.WEB'), releaseTitle: 'Youkoso.S01E02.1080p.WEB' };

    expect(codes((await preflightManualDownload(input)).errors)).toEqual(['TARGET_UNMONITORED']);
    expect(codes((await preflightManualDownload({ ...input, monitorTarget: true })).warnings)).toEqual(['RELEASE_MAPPED_BY_ID', 'TARGET_WILL_BE_MONITORED']);
  });
});

describe('defaultDownloadClient', () => {
  it('prefers clients tagged for the title, then the lowest priority, and gives up on a tie', () => {
    const clients = [client(1, { priority: 1 }), client(2, { priority: 5, tags: [7] }), client(3, { priority: 2 })];
    expect(defaultDownloadClient(clients, [7])?.id).toBe(2);
    expect(defaultDownloadClient(clients, [])?.id).toBe(1);
    expect(defaultDownloadClient([client(1), client(2)], [])).toBeNull();
    expect(defaultDownloadClient([client(1, { tags: [9] })], [])).toBeNull();
  });
});
