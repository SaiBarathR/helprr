// Characterization (golden) tests for the polling service's pollers, written
// before they are moved out of polling-service.ts (Workstream 15). Each poller
// runs once on fixed fixtures at a fixed time; everything it sends out —
// notifications, polling-state and settings writes, badge slices, library
// invalidations, warnings, and the job's own report (failed or skipped) — must
// match polling-pollers.golden.json, recorded from the original code.
// UPDATE_POLLING_GOLDEN=1 rewrites the file (only on purpose).
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = Date.parse('2026-10-19T04:00:00.000Z'); // 09:30 in Asia/Kolkata

const mocks = vi.hoisted(() => ({
  out: [] as unknown[],
  states: new Map<string, Record<string, unknown>>(),
  sonarr: [] as unknown[],
  radarr: [] as unknown[],
  lidarr: [] as unknown[],
  qbit: null as unknown,
  jellyfin: null as unknown,
  seerr: null as unknown,
  connections: {} as Record<string, unknown>,
  serviceConnections: [] as unknown[],
  users: (() => []) as (args: unknown) => unknown[],
  history: [] as unknown[],
  digestRows: [] as unknown[],
  disks: [] as unknown[],
  probe: (() => ({ ok: true })) as (connection: { id: string }) => { ok: boolean; error?: string },
  failClients: {} as Record<string, Error>,
  digestSent: null as unknown,
}));

const record = (kind: string, ...args: unknown[]) => { mocks.out.push({ [kind]: args.length === 1 ? args[0] : args }); };

vi.mock('@/lib/db', () => {
  const pollingState = {
    findUnique: vi.fn(async ({ where }: { where: { serviceConnectionId: string } }) => mocks.states.get(where.serviceConnectionId) ?? null),
    create: vi.fn(async ({ data }: { data: { serviceConnectionId: string } }) => {
      record('pollingState.create', data);
      const row = { lastQueueIds: null, lastHistoryDate: null, lastHistoryId: null, lastHistorySeenIds: null, lastHealthHash: null, lastReachable: null, ...data };
      mocks.states.set(data.serviceConnectionId, row);
      return row;
    }),
    update: vi.fn(async (args: unknown) => { record('pollingState.update', args); return {}; }),
    upsert: vi.fn(async (args: { where: { serviceConnectionId: string }; create: Record<string, unknown> }) => {
      record('pollingState.upsert', args);
      return mocks.states.get(args.where.serviceConnectionId) ?? { lastQueueIds: [], ...args.create };
    }),
    findMany: vi.fn(async () => [...mocks.states.entries()].map(([serviceConnectionId, s]) => ({ serviceConnectionId, lastReachable: s.lastReachable ?? null }))),
  };
  return {
    prisma: {
      pollingState,
      user: { findMany: vi.fn(async (args: unknown) => mocks.users(args)) },
      serviceConnection: { findMany: vi.fn(async () => mocks.serviceConnections) },
      appSettings: { update: vi.fn(async (args: unknown) => { record('appSettings.update', args); return {}; }) },
      notificationHistory: {
        findMany: vi.fn(async (args: { where: { eventType?: unknown } }) => (args.where.eventType === 'upcomingPremiere' ? mocks.history : mocks.digestRows)),
        findFirst: vi.fn(async () => mocks.digestSent),
      },
    },
  };
});
vi.mock('@/lib/notification-service', () => ({
  notifyEvent: vi.fn(async (event: unknown) => { record('notify', event); return 1; }),
  initVapid: vi.fn(),
}));
vi.mock('@/lib/service-helpers', () => {
  const clients = (name: string, value: () => unknown) => vi.fn(async () => {
    if (mocks.failClients[name]) throw mocks.failClients[name];
    return value();
  });
  return {
    getSonarrClients: clients('sonarr', () => mocks.sonarr),
    getRadarrClients: clients('radarr', () => mocks.radarr),
    getLidarrClients: clients('lidarr', () => mocks.lidarr),
    getQBittorrentClient: clients('qbit', () => mocks.qbit),
    getJellyfinClient: clients('jellyfin', () => mocks.jellyfin),
    getSeerrClient: clients('seerr', () => mocks.seerr),
  };
});
vi.mock('@/lib/arr-instances', () => ({ getDefaultConnection: vi.fn(async (type: string) => mocks.connections[type] ?? null) }));
vi.mock('@/lib/activity-queue', () => ({ fetchAllQueueRecords: vi.fn(async (client: { queue: unknown }) => client.queue) }));
vi.mock('@/lib/cache/badge-counts', () => ({ writeBadgeSlice: vi.fn(async (...args: unknown[]) => record('badge', ...args)) }));
vi.mock('@/lib/cache/tagged-library', () => ({
  invalidateTaggedLibrary: vi.fn(async (...args: unknown[]) => record('invalidateLibrary', ...args)),
  getCachedTaggedLibrary: vi.fn(),
}));
vi.mock('@/lib/disk-space', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/disk-space')>()),
  getAggregatedDiskSpace: vi.fn(async () => mocks.disks),
}));
vi.mock('@/lib/service-health', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/service-health')>()),
  probeServiceHealth: vi.fn(async (connection: { id: string }) => mocks.probe(connection)),
}));
vi.mock('@/lib/seerr-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/seerr-helpers')>()),
  getCachedSeerrMediaDetail: vi.fn(async (_client: unknown, type: string, tmdbId: number) => ({ title: type === 'movie' ? `Film ${tmdbId}` : undefined, name: type === 'tv' ? `Show ${tmdbId}` : undefined, releaseDate: '2024-05-01' })),
}));
vi.mock('@/lib/manual-downloads/status', () => ({ reconcileManualDownloads: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn((message: string) => record('log.warn', message)),
    error: vi.fn((message: string) => record('log.error', message)),
  },
  redact: (value: unknown) => value,
}));

import { PollingService } from '@/lib/polling-service';
import { createPollingCycleContext } from '@/lib/polling-cycle';
import { jobReports, type JobReport } from '@/lib/polling-job-report';
import { ConfigurationError } from '@/lib/config-error';

const SETTINGS = {
  notificationGroupingEnabled: false,
  timeZone: 'Asia/Kolkata',
  upcomingNotifyMode: 'before_air',
  upcomingNotifyBeforeMins: 60,
  upcomingDailyNotifyHour: 9,
  diskThresholds: [
    { diskId: 'Media', minFreeGb: 500, enabled: true },
    { diskId: '/downloads', minFreeGb: 50, enabled: true },
    { diskId: 'Backup', minFreeGb: 100, enabled: true },
    { diskId: 'Gone', minFreeGb: 10, enabled: true },
  ],
  diskAlertState: {
    Backup: { below: true, lastAlertAt: '2026-10-19T02:00:00.000Z' },
    '/downloads': { below: true, lastAlertAt: '2026-10-18T10:00:00.000Z' },
  },
  activityDigestMode: 'daily',
  activityDigestHour: 8,
  activityDigestDayOfWeek: 1,
};

const GB = 1024 ** 3;
const at = (iso: string) => new Date(iso).toISOString();

/** A Sonarr/Radarr/Lidarr instance: an earlier queue, a queue now, history since the cursor, and changed health. */
function arrInstance(id: string, label: string, kind: 'sonarr' | 'radarr' | 'lidarr', previous: boolean, extraImports = 0) {
  const media = kind === 'sonarr'
    ? (n: number) => ({ seriesId: 7, episodeId: 70 + n, seasonNumber: 1, series: { tags: [1] } })
    : kind === 'radarr'
      ? (n: number) => ({ movieId: 40 + n, movie: { tags: [1] } })
      : (n: number) => ({ artistId: 9, albumId: 90 + n, artist: { tags: [2] } });
  const quality = { quality: { quality: { name: 'WEBDL-1080p' } } };
  const queueItem = (n: number, state: string, status = 'ok', extra: Record<string, unknown> = {}) => ({
    id: n, title: `${label}.Release.${n}`, trackedDownloadState: state, trackedDownloadStatus: status, ...media(n), ...quality, ...extra,
  });
  if (previous) {
    mocks.states.set(id, {
      serviceConnectionId: id,
      lastQueueIds: [{ id: 10, state: 'downloading', status: 'ok' }, { id: 11, state: 'downloading', status: 'ok' }, 9],
      lastHistoryDate: new Date('2026-10-19T03:00:00.000Z'),
      lastHistoryId: 500,
      lastHistorySeenIds: [500],
      lastHealthHash: 'previous-hash',
    });
  }
  const imported = kind === 'sonarr' ? 'downloadFolderImported' : kind === 'radarr' ? 'movieFileImported' : 'trackFileImported';
  const history = [
    { id: 503, date: at('2026-10-19T03:30:00Z'), eventType: imported, sourceTitle: `${label}.Imported.503`, ...media(3), episode: { seasonNumber: 1, id: 73 }, ...quality },
    { id: 502, date: at('2026-10-19T03:20:00Z'), eventType: 'grabbed', sourceTitle: `${label}.Grabbed.502`, ...media(2) },
    { id: 500, date: at('2026-10-19T03:00:00Z'), eventType: imported, sourceTitle: `${label}.Seen.500`, ...media(0) },
    { id: 499, date: at('2026-10-19T02:59:00Z'), eventType: imported, sourceTitle: `${label}.Old.499`, ...media(9) },
  ];
  // A burst of imports (e.g. a season pack), newest first, for the grouping case.
  for (let n = 1; n <= extraImports; n += 1) {
    history.unshift({ id: 503 + n, date: at(`2026-10-19T03:3${n}:00Z`), eventType: imported, sourceTitle: `${label}.Burst.${503 + n}`, ...media(3 + n), episode: { seasonNumber: 1, id: 73 + n }, ...quality });
  }
  const client = {
    queue: {
      totalRecords: 5,
      records: [
        queueItem(10, 'downloading'),
        queueItem(11, 'importPending', 'warning', { statusMessages: [{ title: 'x', messages: ['', 'No files found are eligible for import'] }] }),
        queueItem(9, 'failedPending', 'warning', { errorMessage: 'legacy item' }),
        queueItem(12, 'downloading'),
        queueItem(13, 'failedPending', 'warning', { errorMessage: 'Tracker said no' }),
      ],
    },
    getTags: vi.fn(async () => [{ id: 1, label: 'kids' }, { id: 2, label: 'jazz' }]),
    getHistory: vi.fn(async (page: number) => ({ records: page === 1 ? history : [] })),
    getHealth: vi.fn(async () => [{ message: `${label} indexer is down` }]),
  };
  return { connection: { id, label, isDefault: true }, client };
}

function qbitFixture() {
  mocks.connections.QBITTORRENT = { id: 'q1' };
  mocks.qbit = { getTorrents: vi.fn(async () => [
    { hash: 'a', name: 'A', progress: 1, state: 'uploading' },
    { hash: 'b', name: 'B', progress: 1, state: 'stalledUP' },
    { hash: 'c', name: 'C', progress: 0.1, state: 'stalledDL' },
    { hash: 'd', name: 'D', progress: 0.4, state: 'downloading' },
  ]) };
}

function jellyfinFixture() {
  mocks.connections.JELLYFIN = { id: 'j1' };
  mocks.users = (args) => ((args as { where: { status?: string } }).where.status === 'active' ? [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }] : [{ id: 'u2', jellyfinUserId: 'jf-ana' }]);
  mocks.jellyfin = { getActiveSessions: vi.fn(async () => [
    { Id: 's-old', UserId: 'jf-ana', UserName: 'ana', NowPlayingItem: { Name: 'Old' } },
    { Id: 's-new', UserId: 'jf-ana', UserName: 'ana', NowPlayingItem: { Name: 'Good News About Hell', SeriesName: 'Severance' } },
    { Id: 's-guest', UserId: 'jf-guest', UserName: 'guest', NowPlayingItem: { Name: 'Perfect Days' } },
    { Id: 's-idle', UserId: 'jf-ana', UserName: 'ana' },
  ]) };
}

function seerrFixture() {
  mocks.connections.SEERR = { id: 'se1' };
  mocks.users = (args) => ((args as { where: { role?: string } }).where.role === 'admin' ? [{ id: 'admin1' }] : [{ id: 'u7', seerrUserId: '7' }]);
  const request = (id: number, status: number, mediaStatus: number, type: 'movie' | 'tv', requester: Record<string, unknown>) => ({
    id, status, type, media: { status: mediaStatus, tmdbId: 1000 + id }, requestedBy: requester,
  });
  mocks.seerr = {
    listRequests: vi.fn(async () => ({ results: [
      request(31, 1, 2, 'movie', { id: 7, displayName: 'Ana' }),
      request(25, 1, 2, 'tv', { id: 8, username: 'ben' }),
      request(20, 2, 3, 'movie', { id: 7, displayName: 'Ana' }),
      request(21, 3, 2, 'tv', { id: 9, plexUsername: 'cy' }),
      request(22, 4, 2, 'movie', { id: 7, displayName: 'Ana' }),
      request(23, 2, 5, 'tv', { id: 7, displayName: 'Ana' }),
      request(30, 1, 2, 'movie', {}),
    ] })),
    getRequestCount: vi.fn(async () => ({ pending: 3 })),
  };
}

/** Episodes, movie releases and albums around NOW, and what was already sent. */
function upcomingFixture() {
  const episode = (id: number, airDateUtc: string, extra: Record<string, unknown> = {}) => ({
    id, seriesId: 7, seasonNumber: 2, episodeNumber: id, title: `Episode ${id}`, airDateUtc, series: { title: 'Severance' }, ...extra,
  });
  mocks.history = [
    { dedupeKey: `sonarr-s1-ep-3-${Date.parse('2026-10-19T04:10:00Z')}`, body: 'x', metadata: null },
    { dedupeKey: null, body: 'Old body', metadata: { grouped: true, itemDedupeKeys: [`radarr-r1-41-digital-${Date.parse('2026-10-19T04:20:00Z')}`] } },
  ];
  mocks.sonarr = [{ connection: { id: 's1', label: 'main', isDefault: true }, client: { getCalendar: vi.fn(async () => [
    episode(1, '2026-10-19T04:30:00Z', { finaleType: 'season' }),
    episode(2, '2026-10-19T06:00:00Z'),
    episode(3, '2026-10-19T04:10:00Z'),
    episode(4, '2026-10-19T03:58:00Z', { finaleType: 'series' }),
    episode(5, '2026-10-19T04:40:00Z', { series: undefined }),
  ]) } }];
  mocks.radarr = [
    { connection: { id: 'r1', label: 'main', isDefault: true }, client: { getCalendar: vi.fn(async () => [
      { id: 40, title: 'Film A', year: 2026, inCinemas: '2026-10-19T04:50:00Z', physicalRelease: '2026-12-01T00:00:00Z' },
      { id: 41, title: 'Film B', year: 2026, digitalRelease: '2026-10-19T04:20:00Z' },
    ]) } },
    { connection: { id: 'r2', label: '4k', isDefault: false }, client: { getCalendar: vi.fn(async () => [
      { id: 40, title: 'Film A', year: 2026, inCinemas: '2026-10-19T04:50:00Z' },
    ]) } },
  ];
  mocks.lidarr = [{ connection: { id: 'l1', label: 'music', isDefault: true }, client: { getCalendar: vi.fn(async () => [
    { id: 90, title: 'Album X', releaseDate: '2026-10-19T04:15:00Z', artist: { artistName: 'Band' } },
    { id: 91, title: 'Album Y', releaseDate: '2026-10-20T04:15:00Z' },
  ]) } }];
}

/** Notification history for yesterday (Asia/Kolkata), as the digest reads it. */
function digestFixture() {
  mocks.digestRows = [
    { eventType: 'imported', body: 'Severance S02E01', metadata: { source: 'sonarr' }, createdAt: new Date('2026-10-18T12:00:00Z') },
    { eventType: 'imported', body: 'Film A', metadata: { source: 'radarr' }, createdAt: new Date('2026-10-18T13:00:00Z') },
    { eventType: 'downloadFailed', body: 'Something', metadata: { source: 'sonarr' }, createdAt: new Date('2026-10-18T14:00:00Z') },
    { eventType: 'torrentCompleted', body: 'C', metadata: { source: 'qbittorrent' }, createdAt: new Date('2026-10-18T15:00:00Z') },
  ];
}

let service: PollingService;
async function run(method: string, settings: typeof SETTINGS = SETTINGS) {
  const context = createPollingCycleContext(async () => settings as never, { instanceConcurrency: 2, startedAtMs: NOW, cycleId: 'golden' });
  // As the cycle does: the job runs inside its report, which says whether it failed or skipped.
  const report: JobReport = { failure: null, skipped: false };
  await jobReports.run(report, () => (service as unknown as Record<string, (context: unknown) => Promise<void>>)[method](context));
  record('jobReport', report);
  return JSON.parse(JSON.stringify(mocks.out)) as unknown[];
}

const GOLDEN_PATH = path.join(__dirname, 'polling-pollers.golden.json');
const golden: Record<string, unknown> = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
const recorded: Record<string, unknown> = {};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  mocks.out = [];
  mocks.states = new Map();
  mocks.sonarr = [];
  mocks.radarr = [];
  mocks.lidarr = [];
  mocks.history = [];
  mocks.digestRows = [];
  mocks.users = () => [];
  mocks.qbit = null;
  mocks.jellyfin = null;
  mocks.seerr = null;
  mocks.connections = {};
  mocks.serviceConnections = [];
  mocks.disks = [];
  mocks.probe = () => ({ ok: true });
  mocks.failClients = {};
  mocks.digestSent = null;
  service = new PollingService();
});
afterEach(() => {
  vi.useRealTimers();
  if (process.env.UPDATE_POLLING_GOLDEN) writeFileSync(GOLDEN_PATH, `${JSON.stringify({ ...golden, ...recorded }, null, 1)}\n`);
});

function expectGolden(name: string, actual: unknown[]) {
  recorded[name] = actual;
  if (!process.env.UPDATE_POLLING_GOLDEN) expect(actual).toEqual(golden[name]);
}

describe('pollers on fixed fixtures (golden)', () => {
  it.each([
    ['pollSonarr', 'sonarr'],
    ['pollRadarr', 'radarr'],
    ['pollLidarr', 'lidarr'],
  ] as const)('%s: queue transitions, new history, health, two instances and a first run', async (method, kind) => {
    mocks[kind] = [arrInstance('i1', 'Main', kind, true), arrInstance('i2', 'Anime', kind, false)];
    expectGolden(method, await run(method));
  });

  it('pollQBittorrent: added, completed and removed torrents, and the downloads badge', async () => {
    qbitFixture();
    mocks.states.set('q1', { serviceConnectionId: 'q1', lastQueueIds: [{ hash: 'a', progress: 0.5, name: 'A' }, { hash: 'b', progress: 1, name: 'B' }, { hash: 'gone', progress: 0.2, name: 'Gone' }] });
    expectGolden('pollQBittorrent', await run('pollQBittorrent'));
  });

  it('pollJellyfin: new playback, for linked and unlinked streamers', async () => {
    jellyfinFixture();
    mocks.states.set('j1', { serviceConnectionId: 'j1', lastQueueIds: ['s-old'] });
    expectGolden('pollJellyfin', await run('pollJellyfin'));
  });

  it('pollSeerr: created, approved, declined, failed and available requests, and the requests badge', async () => {
    seerrFixture();
    mocks.states.set('se1', { serviceConnectionId: 'se1', lastQueueIds: [
      { id: 20, reqStatus: 1, mediaStatus: 2 }, { id: 21, reqStatus: 1, mediaStatus: 2 }, { id: 22, reqStatus: 1, mediaStatus: 2 },
      { id: 23, reqStatus: 2, mediaStatus: 3 }, { id: 30, reqStatus: 1, mediaStatus: 2 },
    ] });
    expectGolden('pollSeerr', await run('pollSeerr'));
  });

  it('pollServiceReachability: down, restored, unchanged and first-seen services', async () => {
    mocks.serviceConnections = [
      { id: 'c1', type: 'SONARR', label: 'main' }, { id: 'c2', type: 'RADARR', label: 'main' },
      { id: 'c3', type: 'QBITTORRENT', label: 'qbit' }, { id: 'c4', type: 'JELLYFIN', label: 'jf' },
    ];
    for (const [id, lastReachable] of [['c1', true], ['c2', false], ['c3', true]] as const) mocks.states.set(id, { serviceConnectionId: id, lastReachable });
    mocks.probe = (connection) => (connection.id === 'c1' ? { ok: false, error: 'ECONNREFUSED' } : { ok: true });
    expectGolden('pollServiceReachability', await run('pollServiceReachability'));
  });

  it('checkDiskSpace: a new drop, a reminder after the cooldown, one inside it, a recovery, and a disk gone', async () => {
    mocks.disks = [
      { path: '/mnt/media', label: 'Media', freeSpace: 400 * GB, totalSpace: 4000 * GB },
      { path: '/downloads', label: '', freeSpace: 20 * GB, totalSpace: 1000 * GB },
      { path: '/mnt/backup', label: 'Backup', freeSpace: 90 * GB, totalSpace: 2000 * GB },
      { path: '/mnt/ok', label: 'Fine', freeSpace: 900 * GB, totalSpace: 1000 * GB },
    ];
    expectGolden('checkDiskSpace', await run('checkDiskSpace'));
  });

  it('checkUpcoming: episodes, movie releases and albums inside the before-air window, deduplicated', async () => {
    upcomingFixture();
    expectGolden('checkUpcoming', await run('checkUpcoming'));
  });

  it("checkActivityDigest: yesterday's events summarized once the digest hour has passed", async () => {
    digestFixture();
    expectGolden('checkActivityDigest', await run('checkActivityDigest'));
  });

  it('pollSonarr with grouping on: a burst of imports sent as one grouped notification', async () => {
    mocks.sonarr = [arrInstance('i1', 'Main', 'sonarr', true, 3)];
    expectGolden('pollSonarr:grouped', await run('pollSonarr', { ...SETTINGS, notificationGroupingEnabled: true }));
  });

  it('pollRadarr: an instance whose history fails is reported while the other carries on', async () => {
    const failing = arrInstance('i1', 'Main', 'radarr', true);
    failing.client.getHistory = vi.fn(async () => { throw new Error('history down'); });
    mocks.radarr = [failing, arrInstance('i2', 'Anime', 'radarr', true)];
    expectGolden('pollRadarr:instanceFails', await run('pollRadarr'));
  });

  it('pollSonarr: clients that cannot be built fail the job and send nothing', async () => {
    mocks.failClients.sonarr = new Error('decrypt failed');
    expectGolden('pollSonarr:clientsFail', await run('pollSonarr'));
  });

  it.each([
    ['pollQBittorrent', qbitFixture],
    ['pollJellyfin', jellyfinFixture],
    ['pollSeerr', seerrFixture],
  ] as const)('%s: a first run with no saved state', async (method, fixture) => {
    fixture();
    expectGolden(`${method}:firstRun`, await run(method));
  });

  it('pollQBittorrent and pollSeerr: not configured is not a failure; a broken client is', async () => {
    mocks.failClients.qbit = new ConfigurationError('qBittorrent is not configured.');
    mocks.failClients.seerr = new Error('Seerr unreachable');
    const qbit = await run('pollQBittorrent');
    mocks.out = [];
    expectGolden('pollQBittorrent+pollSeerr:clientErrors', [...qbit, ...(await run('pollSeerr'))]);
  });

  it('checkDiskSpace: no thresholds set does nothing', async () => {
    mocks.disks = [{ path: '/mnt/media', label: 'Media', freeSpace: 1 * GB, totalSpace: 4000 * GB }];
    expectGolden('checkDiskSpace:noThresholds', await run('checkDiskSpace', { ...SETTINGS, diskThresholds: [] }));
  });

  it("checkUpcoming in daily digest mode: today's items at the digest hour (09:00 here), skipped an hour after or before it", async () => {
    upcomingFixture();
    const out: unknown[] = [];
    for (const hour of [9, 8, 10]) {
      mocks.out = [];
      out.push(...(await run('checkUpcoming', { ...SETTINGS, upcomingNotifyMode: 'daily_digest', upcomingDailyNotifyHour: hour })));
    }
    expectGolden('checkUpcoming:dailyDigest', out);
  });

  it('checkActivityDigest: weekly on its day; skipped before the hour, on another day, or when already sent', async () => {
    digestFixture();
    const runs = [
      { ...SETTINGS, activityDigestMode: 'weekly', activityDigestDayOfWeek: 1 },
      { ...SETTINGS, activityDigestHour: 10 },
      { ...SETTINGS, activityDigestMode: 'weekly', activityDigestDayOfWeek: 2 },
    ];
    const out: unknown[] = [];
    for (const settings of runs) {
      mocks.out = [];
      out.push(...(await run('checkActivityDigest', settings)));
    }
    mocks.out = [];
    mocks.digestSent = { id: 'sent' };
    out.push(...(await run('checkActivityDigest')));
    expectGolden('checkActivityDigest:modes', out);
  });
});
