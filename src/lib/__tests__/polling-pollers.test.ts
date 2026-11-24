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
  // Who could receive an upcoming film or album (notification-service).
  recipients: [] as Array<{ id: string; timeZone: string | null }>,
  watchlist: (() => []) as () => unknown[],
  watchlistMarked: new Set<string>(),
  announced: new Set<string>(),
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
      watchlistItem: {
        findMany: vi.fn(async () => mocks.watchlist()),
        updateMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
          const fresh = where.id.in.filter((id) => !mocks.watchlistMarked.has(id));
          fresh.forEach((id) => mocks.watchlistMarked.add(id));
          return { count: fresh.length };
        }),
      },
      // Episodes claimed by personal alerts; a repeat insert is skipped.
      announcedEpisode: {
        createManyAndReturn: vi.fn(async ({ data }: { data: Array<{ userId: string; episodeKey: string }> }) => data
          .filter((row) => !mocks.announced.has(`${row.userId}|${row.episodeKey}`))
          .map((row) => { mocks.announced.add(`${row.userId}|${row.episodeKey}`); return { episodeKey: row.episodeKey }; })),
      },
      serviceConnection: { findMany: vi.fn(async () => mocks.serviceConnections) },
      appSettings: { update: vi.fn(async (args: unknown) => { record('appSettings.update', args); return {}; }) },
      notificationHistory: {
        // A row with a createdAt is read back only inside the poller's lookback.
        findMany: vi.fn(async (args: { where: { eventType?: unknown; createdAt?: { gte: Date } } }) => (args.where.eventType === 'upcomingPremiere'
          ? (mocks.history as Array<{ createdAt?: Date }>).filter((row) => !row.createdAt || !args.where.createdAt || row.createdAt >= args.where.createdAt.gte)
          : mocks.digestRows)),
        findFirst: vi.fn(async () => mocks.digestSent),
      },
    },
  };
});
vi.mock('@/lib/notification-service', () => ({
  notifyEvent: vi.fn(async (event: unknown) => { record('notify', event); return 1; }),
  initVapid: vi.fn(),
  usersWhoCouldReceive: vi.fn(async () => mocks.recipients),
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
    getJellyfinUserContext: vi.fn(async (user: { jellyfinUserId: string }) => ({
      client: mocks.jellyfin, connectionFingerprint: 'fp', jellyfinUserId: user.jellyfinUserId,
    })),
    isJellyfinUnavailable: () => false,
  };
});
vi.mock('@/lib/cache/jellyfin-watch-status-cache', () => ({
  getWatchStatusJson: vi.fn(async (_seed: string, fetcher: () => Promise<unknown>) => fetcher()),
}));
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
import { EMPTY_HEALTH_HASH, HEALTH_CLEAR_HOLD_MS, resetHealthTracking } from '@/lib/polling/health-transition';
import upgradeHistory from '@/lib/polling/__fixtures__/arr-upgrade-history.json';

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
        queueItem(13, 'failedPending', 'warning', { errorMessage: 'Tracker said no', downloadId: 'HASH13' }),
      ],
    },
    getTags: vi.fn(async () => [{ id: 1, label: 'kids' }, { id: 2, label: 'jazz' }]),
    getHistory: vi.fn(async (page: number) => ({ records: page === 1 ? history : [] })),
    getHealth: vi.fn(async () => [{ message: `${label} indexer is down` }]),
  };
  return { connection: { id, label, isDefault: true, updatedAt: new Date(0) }, client };
}

/** An instance whose history is real upgrade rows (upgrade-imports fixture), read from the given cursor. */
function upgradeInstance(kind: 'sonarr' | 'radarr', cursor: { date: string; id: number }) {
  mocks.states.set('u1', {
    serviceConnectionId: 'u1', lastQueueIds: [], lastHistoryDate: new Date(cursor.date), lastHistoryId: cursor.id, lastHistorySeenIds: [cursor.id], lastHealthHash: EMPTY_HEALTH_HASH,
  });
  const client = {
    queue: { totalRecords: 0, records: [] },
    getTags: vi.fn(async () => []),
    getHistory: vi.fn(async (page: number) => ({ records: page === 1 ? upgradeHistory[kind] : [] })),
    getHealth: vi.fn(async () => []),
  };
  return [{ connection: { id: 'u1', label: 'Main', isDefault: true, updatedAt: new Date(0) }, client }];
}

const notified = (out: unknown[]) => out.flatMap((o) => {
  const event = (o as { notify?: { eventType: string; title: string; body: string; url: string } }).notify;
  return event ? [{ eventType: event.eventType, title: event.title, body: event.body, url: event.url }] : [];
});

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
async function run(method: string, settings: typeof SETTINGS = SETTINGS, startedAtMs = NOW) {
  const context = createPollingCycleContext(async () => settings as never, { instanceConcurrency: 2, startedAtMs, cycleId: 'golden' });
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
  mocks.recipients = [];
  mocks.watchlist = () => [];
  mocks.watchlistMarked = new Set();
  mocks.announced = new Set();
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
    // No delay: the down alert goes out at the first failed check, as it always did.
    expectGolden('pollServiceReachability', await run('pollServiceReachability', { ...SETTINGS, serviceDownAlertDelaySecs: 0 } as typeof SETTINGS));
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
    // Film and album pushes count to the release day's local midnight in the
    // user's zone: Oct 19 starts at NOW (04:00Z) in New York. Film B was sent
    // under its zone-less key (the UTC-midnight rule) and is not sent again.
    mocks.recipients = [{ id: 'u1', timeZone: 'America/New_York' }];
    expectGolden('checkUpcoming', await run('checkUpcoming'));
    // Premiere alerts are for monitored items only: the *arrs' calendar default,
    // never the Calendar page's unmonitored=true.
    const calendars = [...mocks.sonarr, ...mocks.radarr, ...mocks.lidarr] as Array<{ client: { getCalendar: ReturnType<typeof vi.fn> } }>;
    for (const { client } of calendars) {
      expect(client.getCalendar).toHaveBeenCalled();
      for (const call of client.getCalendar.mock.calls) expect(call).toHaveLength(2);
    }
  });

  it("checkActivityDigest: yesterday's events summarized once the digest hour has passed", async () => {
    digestFixture();
    expectGolden('checkActivityDigest', await run('checkActivityDigest'));
  });

  it('pollSonarr with grouping on: a burst of imports sent as one grouped notification', async () => {
    mocks.sonarr = [arrInstance('i1', 'Main', 'sonarr', true, 3)];
    expectGolden('pollSonarr:grouped', await run('pollSonarr', { ...SETTINGS, notificationGroupingEnabled: true }));
  });

  it('pollSonarr: a new episode of a show a member is watching, imported on two instances, alerts them once', async () => {
    mocks.sonarr = [arrInstance('i1', 'Main', 'sonarr', true), arrInstance('i2', 'Anime', 'sonarr', true)];
    for (const { client } of mocks.sonarr as ReturnType<typeof arrInstance>[]) {
      const { records } = await client.getHistory(1);
      Object.assign((records[0] as { series: object }).series, { title: 'Severance', tvdbId: 371980 });
      Object.assign((records[0] as { episode: object }).episode, { episodeNumber: 5, title: 'Trojan Horse' });
    }
    mocks.users = (args) => ((args as { where: { jellyfinUserId?: unknown } }).where.jellyfinUserId
      ? [{ id: 'u1', role: 'member', status: 'active', template: 'member', permissions: {}, jellyfinUserId: 'jf-1', settings: null }]
      : []);
    mocks.jellyfin = {
      queryItems: vi.fn(async (params: { IncludeItemTypes?: string }) => (params.IncludeItemTypes === 'Episode'
        ? { Items: [{ Id: 'e1', SeriesId: 'jf-sev', UserData: { LastPlayedDate: new Date().toISOString() } }] }
        : { Items: [{ Id: 'jf-sev', ProviderIds: { Tvdb: '371980' } }] })),
    };
    const out = await run('pollSonarr');
    const alerts = out.flatMap((o) => {
      const event = (o as { notify?: { eventType: string } }).notify;
      return event?.eventType === 'watchingNewEpisode' ? [event] : [];
    });
    expect(alerts).toEqual([
      expect.objectContaining({ title: 'New episode: Severance S01E05 · Trojan Horse', userIds: ['u1'], ownerUserId: 'u1' }),
    ]);
  });

  it('pollRadarr: a watchlisted movie imported on two instances alerts its owner once', async () => {
    mocks.radarr = [arrInstance('i1', 'Main', 'radarr', true), arrInstance('i2', 'Anime', 'radarr', true)];
    for (const { client } of mocks.radarr as ReturnType<typeof arrInstance>[]) {
      const { records } = await client.getHistory(1);
      Object.assign((records[0] as { movie: object }).movie, { title: 'Dune', tmdbId: 438631 });
    }
    mocks.watchlist = () => [{
      id: 'w1', source: 'TMDB', externalId: '438631', mediaType: 'movie', title: 'Dune',
      user: { id: 'u1', role: 'member', status: 'active', template: 'member', permissions: {} },
    }];
    const out = await run('pollRadarr');
    const alerts = out.flatMap((o) => {
      const event = (o as { notify?: { eventType: string } }).notify;
      return event?.eventType === 'watchlistAvailable' ? [event] : [];
    });
    expect(alerts).toEqual([
      expect.objectContaining({ title: 'Now in your library: Dune', url: '/watchlist?focus=w1', userIds: ['u1'], ownerUserId: 'u1' }),
    ]);
  });

  it('pollSonarr on real history: an upgrade is sent as Episode Upgraded with its qualities, a new episode as Episode Imported', async () => {
    mocks.sonarr = upgradeInstance('sonarr', { date: '2026-10-18T00:00:00Z', id: 1 });
    const out = await run('pollSonarr');
    expectGolden('pollSonarr:upgrades', out);
    // The collector sends by event type: the upgrades, then the new episodes. Each opens its episode.
    expect(notified(out)).toEqual([
      { eventType: 'upgraded', title: 'Episode Upgraded', body: 'WEBDL-1080p → HDTV-1080p: Merry Berry Love (2026) s01e03 [Mkv - 1080p H264 - MultiLang Aac 2.0 - MultiSubs]', url: '/series/308/season/1/episode/13946?instance=u1' },
      { eventType: 'upgraded', title: 'Episode Upgraded', body: 'WEBDL-720p → HDTV-1080p: [SubsPlease] Ao Ashi S2 - 03 (1080p) [81A40CFE]', url: '/series/172/season/2/episode/10964?instance=u1' },
      { eventType: 'imported', title: 'Episode Imported', body: 'Merry Berry Love S01E03 MULTi 1080p WEB H264-AZR', url: '/series/308/season/1/episode/13946?instance=u1' },
      { eventType: 'imported', title: 'Episode Imported', body: expect.stringMatching(/^\[Erai-raws\] Aoashi S02E03 /), url: '/series/172/season/2/episode/10964?instance=u1' },
    ]);
  });

  it('pollSonarr: an import whose Upgrade deletion the previous poll already read is still an upgrade', async () => {
    // The cursor stands on the deletion (9555): only the import (9556) is new.
    mocks.sonarr = upgradeInstance('sonarr', { date: '2026-10-24T11:43:29Z', id: 9555 });
    expect(notified(await run('pollSonarr')).map((e) => [e.eventType, e.title])).toEqual([['upgraded', 'Episode Upgraded']]);
  });

  it('pollRadarr on real history: upgrades are sent as Movie Upgraded, first imports as Movie Imported', async () => {
    mocks.radarr = upgradeInstance('radarr', { date: '2026-10-01T00:00:00Z', id: 1 });
    const out = await run('pollRadarr');
    expectGolden('pollRadarr:upgrades', out);
    expect(notified(out).map((e) => [e.eventType, e.body.split(': ')[0]])).toEqual([
      ['upgraded', 'WEBDL-1080p → WEBDL-2160p'],
      ['upgraded', 'Better WEBDL-2160p'],
      ['upgraded', 'WEBRip-1080p → WEBDL-2160p'],
      ['imported', 'Primetime.2026.1080p.AMZN.WEB-DL.DDP5.1.H264.MP4-BTM'],
      ['imported', 'Insidious Out Of The Further (2026) [1080p] [WEBRip] [5.1] [YTS.GG - YTS.BZ]'],
    ]);
  });

  it('pollRadarr with grouping on: a burst of upgrades is grouped as Movies Upgraded, apart from new imports', async () => {
    mocks.radarr = upgradeInstance('radarr', { date: '2026-10-01T00:00:00Z', id: 1 });
    const events = notified(await run('pollRadarr', { ...SETTINGS, notificationGroupingEnabled: true }));
    expect(events.map((e) => [e.eventType, e.title])).toEqual([
      ['upgraded', '3 Movies Upgraded'],
      ['imported', 'Movie Imported'],
      ['imported', 'Movie Imported'],
    ]);
    // Three different movies: the group opens History, not one title.
    expect(events[0].url).toBe('/activity/history');
  });

  it('pollRadarr: an instance whose history fails is reported while the other carries on', async () => {
    const failing = arrInstance('i1', 'Main', 'radarr', true);
    failing.client.getHistory = vi.fn(async () => { throw new Error('history down'); });
    mocks.radarr = [failing, arrInstance('i2', 'Anime', 'radarr', true)];
    expectGolden('pollRadarr:instanceFails', await run('pollRadarr'));
  });

  it.each([
    ['pollSonarr', 'sonarr', 'Sonarr'],
    ['pollRadarr', 'radarr', 'Radarr'],
  ] as const)('%s: health that clears sends one restored push after the hold, then nothing', async (method, kind, name) => {
    resetHealthTracking();
    const instance = arrInstance('i1', 'Main', kind, true);
    instance.client.getHealth = vi.fn(async () => []);
    mocks[kind] = [instance];
    const state = mocks.states.get('i1')!;
    const cycle = async () => {
      mocks.out = [];
      state.updatedAt = new Date();
      const out = await run(method);
      const healthEvents = out.flatMap((o) => {
        const event = (o as { notify?: { eventType: string } }).notify;
        return event?.eventType.startsWith('health') ? [event] : [];
      });
      const update = out.find((o) => 'pollingState.update' in (o as object)) as { 'pollingState.update': { data: { lastHealthHash: string } } };
      state.lastHealthHash = update['pollingState.update'].data.lastHealthHash;
      return healthEvents;
    };

    // Clear, but not for long enough: nothing sent and the old hash kept.
    expect(await cycle()).toEqual([]);
    expect(state.lastHealthHash).toBe('previous-hash');

    vi.setSystemTime(NOW + HEALTH_CLEAR_HOLD_MS);
    expect(await cycle()).toEqual([{
      eventType: 'healthRestored',
      title: `${name} Health Restored`,
      body: 'All health checks pass again',
      url: `/settings/status?health=${kind}&instance=i1`,
      metadata: { source: kind, instanceId: 'i1', redirect: `/settings/status?health=${kind}&instance=i1` },
      // Keyed on when the all-clear began (the first clear poll), not on updatedAt.
      dedupeKey: `${kind}-health-restored:i1:${NOW}`,
    }]);
    expect(state.lastHealthHash).toBe(EMPTY_HEALTH_HASH);

    vi.setSystemTime(NOW + 3 * HEALTH_CLEAR_HOLD_MS);
    expect(await cycle()).toEqual([]);
  });

  it.each([
    ['pollSonarr', 'sonarr'],
    ['pollRadarr', 'radarr'],
  ] as const)('%s: a warning that clears and returns inside the hold sends nothing; pushes not recorded are retried', async (method, kind) => {
    resetHealthTracking();
    const instance = arrInstance('i1', 'Main', kind, false);
    const issues = [{ message: 'Main indexer is down' }];
    let health: Array<{ message: string }> = issues;
    instance.client.getHealth = vi.fn(async () => health);
    mocks[kind] = [instance];
    const notifyEvent = vi.mocked((await import('@/lib/notification-service')).notifyEvent);
    const cycle = async () => {
      mocks.out = [];
      const out = await run(method);
      const update = out.find((o) => 'pollingState.update' in (o as object)) as { 'pollingState.update': { data: { lastHealthHash: string } } };
      const state = mocks.states.get('i1')!;
      state.lastHealthHash = update['pollingState.update'].data.lastHealthHash;
      state.lastQueueIds = [];
      return out.flatMap((o) => {
        const event = (o as { notify?: { eventType: string } }).notify;
        return event?.eventType.startsWith('health') ? [event.eventType] : [];
      });
    };

    await cycle(); // first run: the baseline, with issues
    const withIssues = mocks.states.get('i1')!.lastHealthHash;
    health = [];
    expect(await cycle()).toEqual([]);
    vi.setSystemTime(NOW + HEALTH_CLEAR_HOLD_MS - 1000);
    health = issues;
    expect(await cycle()).toEqual([]);
    expect(mocks.states.get('i1')!.lastHealthHash).toBe(withIssues);

    // A restore that could not be recorded keeps the old hash, and the next cycle sends it.
    health = [];
    await cycle();
    vi.setSystemTime(NOW + 3 * HEALTH_CLEAR_HOLD_MS);
    notifyEvent.mockRejectedValueOnce(new Error('history insert failed'));
    expect(await cycle()).toEqual([]);
    expect(mocks.states.get('i1')!.lastHealthHash).toBe(withIssues);
    expect(await cycle()).toEqual(['healthRestored']);
    expect(mocks.states.get('i1')!.lastHealthHash).toBe(EMPTY_HEALTH_HASH);

    // So does a warning that could not be recorded.
    health = issues;
    notifyEvent.mockRejectedValueOnce(new Error('history insert failed'));
    expect(await cycle()).toEqual([]);
    expect(mocks.states.get('i1')!.lastHealthHash).toBe(EMPTY_HEALTH_HASH);
    expect(await cycle()).toEqual(['healthWarning']);
    expect(mocks.states.get('i1')!.lastHealthHash).toBe(withIssues);
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

  it("checkUpcoming's daily digest west of UTC takes the releases dated today, not tomorrow's UTC midnight", async () => {
    // NOW is 21:00 on Oct 18 in Los Angeles; Oct 19's UTC midnight is 17:00 that day.
    const radarrCalendar = vi.fn(async () => [
      { id: 50, title: 'Tomorrow Film', year: 2026, inCinemas: '2026-10-19T00:00:00Z' },
      { id: 51, title: 'Today Film', year: 2026, digitalRelease: '2026-10-18T00:00:00Z' },
    ]);
    mocks.radarr = [{ connection: { id: 'r1', label: 'main', isDefault: true }, client: { getCalendar: radarrCalendar } }];
    mocks.lidarr = [{ connection: { id: 'l1', label: 'music', isDefault: true }, client: { getCalendar: vi.fn(async () => [
      { id: 92, title: 'Today Album', releaseDate: '2026-10-18T00:00:00Z', artist: { artistName: 'Band' } },
      { id: 93, title: 'Tomorrow Album', releaseDate: '2026-10-19T00:00:00Z', artist: { artistName: 'Band' } },
    ]) } }];
    const out = await run('checkUpcoming', { ...SETTINGS, timeZone: 'America/Los_Angeles', upcomingNotifyMode: 'daily_digest', upcomingDailyNotifyHour: 21 });
    const bodies = out.flatMap((entry) => ('notify' in (entry as object) ? [(entry as { notify: { body: string } }).notify.body] : []));
    expect(bodies).toEqual(['Today Film (2026) — Digital Release', 'Band — Today Album']);
    // The local day (07:00Z to 06:59:59Z), a day wider on each side.
    expect(radarrCalendar).toHaveBeenCalledWith('2026-10-17T07:00:00.000Z', '2026-10-20T06:59:59.999Z');
  });

  describe("checkUpcoming before air: films and albums count to the release day's local midnight", () => {
    // Oct 20's releases, given as its UTC midnight.
    const releaseMs = Date.parse('2026-10-20T00:00:00Z');
    const KOLKATA_MIDNIGHT = Date.parse('2026-10-19T18:30:00Z');
    const LA_MIDNIGHT = Date.parse('2026-10-20T07:00:00Z');
    const film = (at: number) => `radarr-r1-50-cinema-${releaseMs}@${at}`;
    const album = (at: number) => `lidarr-l1-90-${releaseMs}@${at}`;
    let radarrCalendar: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      radarrCalendar = vi.fn(async () => [{ id: 50, title: 'Film', year: 2026, inCinemas: '2026-10-20T00:00:00Z' }]);
      mocks.radarr = [{ connection: { id: 'r1', label: 'main', isDefault: true }, client: { getCalendar: radarrCalendar } }];
      mocks.lidarr = [{ connection: { id: 'l1', label: 'music', isDefault: true }, client: { getCalendar: vi.fn(async () => [
        { id: 90, title: 'Album', releaseDate: '2026-10-20T00:00:00Z', artist: { artistName: 'Band' } },
      ]) } }];
    });
    const sends = (out: unknown[]) => out.flatMap((entry) => {
      if (!('notify' in (entry as object))) return [];
      const { body, dedupeKey, userIds } = (entry as { notify: { body: string; dedupeKey: string; userIds?: string[] } }).notify;
      return [{ body, dedupeKey, ...(userIds ? { userIds } : {}) }];
    });
    const keys = (out: unknown[]) => sends(out).map((send) => send.dedupeKey);
    const IN_45_MIN_UTC = Date.parse('2026-10-19T23:15:00Z'); // 45 min before UTC midnight (the old moment)
    const KOLKATA_23_15 = Date.parse('2026-10-19T17:45:00Z');
    const LA_23_15 = Date.parse('2026-10-20T06:15:00Z');
    const LA = { ...SETTINGS, timeZone: 'America/Los_Angeles' };

    it('in India: 45 min before 00:00 IST, not before 05:30 IST', async () => {
      expect(sends(await run('checkUpcoming', SETTINGS, KOLKATA_23_15))).toEqual([
        { body: 'Film (2026) — In Cinemas', dedupeKey: film(KOLKATA_MIDNIGHT) },
        { body: 'Band — Album', dedupeKey: album(KOLKATA_MIDNIGHT) },
      ]);
      // A day more on each side, so a release is returned wherever its local midnight falls.
      expect(radarrCalendar).toHaveBeenCalledWith('2026-10-18T17:40:00.000Z', '2026-10-20T18:46:00.000Z');
      mocks.out = [];
      expect(sends(await run('checkUpcoming', SETTINGS, IN_45_MIN_UTC))).toEqual([]);
    });

    it('in Los Angeles: 45 min before its midnight, not at 4:15 PM the day before', async () => {
      expect(sends(await run('checkUpcoming', LA, IN_45_MIN_UTC))).toEqual([]);
      mocks.out = [];
      expect(keys(await run('checkUpcoming', LA, LA_23_15))).toEqual([film(LA_MIDNIGHT), album(LA_MIDNIGHT)]);
    });

    it("in each recipient's own zone (else the app's): one send per midnight, to its users", async () => {
      mocks.recipients = [
        { id: 'u1', timeZone: 'Asia/Kolkata' },
        { id: 'u2', timeZone: null },
        { id: 'u3', timeZone: 'America/Los_Angeles' },
        { id: 'u4', timeZone: 'Not/AZone' },
      ];
      expect(sends(await run('checkUpcoming', LA, KOLKATA_23_15))).toEqual([
        { body: 'Film (2026) — In Cinemas', dedupeKey: film(KOLKATA_MIDNIGHT), userIds: ['u1'] },
        { body: 'Band — Album', dedupeKey: album(KOLKATA_MIDNIGHT), userIds: ['u1'] },
      ]);
      // India's send does not hold back Los Angeles' later one.
      mocks.history = [{ dedupeKey: film(KOLKATA_MIDNIGHT), body: 'x', metadata: { recipientUserIds: ['u1'] } }];
      mocks.out = [];
      expect(sends(await run('checkUpcoming', LA, LA_23_15))[0]).toEqual(
        { body: 'Film (2026) — In Cinemas', dedupeKey: film(LA_MIDNIGHT), userIds: ['u2', 'u3', 'u4'] },
      );
    });

    it.each([
      ['Asia/Kolkata', 'Asia/Calcutta', KOLKATA_23_15, KOLKATA_MIDNIGHT],
      ['Europe/Paris', 'Europe/Berlin', Date.parse('2026-10-19T21:15:00Z'), Date.parse('2026-10-19T22:00:00Z')],
    ])('sends once to %s and %s, whose midnight is the same instant', async (a, b, at, midnight) => {
      mocks.recipients = [{ id: 'u1', timeZone: a }, { id: 'u2', timeZone: b }];
      expect(keys(await run('checkUpcoming', SETTINGS, at))).toEqual([film(midnight), album(midnight)]);
    });

    it('sends once to UTC and London in winter, and per zone once London is an hour ahead', async () => {
      mocks.recipients = [{ id: 'u1', timeZone: 'UTC' }, { id: 'u2', timeZone: 'Europe/London' }];
      // Dec 1: London is on UTC.
      const winter = Date.parse('2026-12-01T00:00:00Z');
      radarrCalendar.mockResolvedValue([{ id: 50, title: 'Film', year: 2026, inCinemas: '2026-12-01T00:00:00Z' }]);
      mocks.lidarr = [];
      expect(sends(await run('checkUpcoming', SETTINGS, winter - 45 * 60_000))).toEqual([
        { body: 'Film (2026) — In Cinemas', dedupeKey: `radarr-r1-50-cinema-${winter}@${winter}` },
      ]);
      // Oct 20: London (BST) starts its day an hour before UTC.
      radarrCalendar.mockResolvedValue([{ id: 50, title: 'Film', year: 2026, inCinemas: '2026-10-20T00:00:00Z' }]);
      mocks.out = [];
      expect(sends(await run('checkUpcoming', SETTINGS, Date.parse('2026-10-19T22:15:00Z')))).toEqual([
        { body: 'Film (2026) — In Cinemas', dedupeKey: film(Date.parse('2026-10-19T23:00:00Z')), userIds: ['u2'] },
      ]);
    });

    it('does not send again to a user who changed zone after their send', async () => {
      // u1 had it at India's midnight, then moved to Los Angeles.
      mocks.history = [{ dedupeKey: film(KOLKATA_MIDNIGHT), body: 'x', metadata: { recipientUserIds: ['u1'] } }];
      mocks.recipients = [{ id: 'u1', timeZone: 'America/Los_Angeles' }, { id: 'u2', timeZone: 'America/Los_Angeles' }];
      expect(sends(await run('checkUpcoming', LA, LA_23_15))[0]).toEqual(
        { body: 'Film (2026) — In Cinemas', dedupeKey: film(LA_MIDNIGHT), userIds: ['u2'] },
      );
      mocks.recipients = [{ id: 'u1', timeZone: 'America/Los_Angeles' }];
      mocks.out = [];
      expect(keys(await run('checkUpcoming', LA, LA_23_15))).toEqual([album(LA_MIDNIGHT)]);
    });

    it("still sends Los Angeles its films after India's went out as one grouped push", async () => {
      // Three films from one Radarr for the same recipients group into one row;
      // that row must say who it went to, or it reads back as sent to everyone.
      const grouping = { ...LA, notificationGroupingEnabled: true };
      radarrCalendar.mockResolvedValue([50, 51, 52].map((id) => ({ id, title: `Film ${id}`, year: 2026, inCinemas: '2026-10-20T00:00:00Z' })));
      mocks.lidarr = [];
      mocks.recipients = [{ id: 'u1', timeZone: 'Asia/Kolkata' }, { id: 'u2', timeZone: 'America/Los_Angeles' }];
      const india = (await run('checkUpcoming', grouping, KOLKATA_23_15)).flatMap((entry) =>
        ('notify' in (entry as object) ? [(entry as { notify: { dedupeKey?: string; body: string; userIds?: string[]; metadata: Record<string, unknown> } }).notify] : []));
      expect(india).toHaveLength(1);
      expect(india[0]).toMatchObject({ title: '3 Upcoming Movies', userIds: ['u1'] });
      // notifyEvent stores the grouped event as its history row.
      mocks.history = india.map((event) => ({ dedupeKey: event.dedupeKey ?? null, body: event.body, metadata: event.metadata }));
      mocks.out = [];
      const la = (await run('checkUpcoming', grouping, LA_23_15)).flatMap((entry) =>
        ('notify' in (entry as object) ? [(entry as { notify: { userIds?: string[]; metadata: { itemDedupeKeys?: string[] } } }).notify] : []));
      expect(la).toHaveLength(1);
      expect(la[0].userIds).toEqual(['u2']);
      expect(la[0].metadata.itemDedupeKeys).toEqual([50, 51, 52].map((id) => `radarr-r1-${id}-cinema-${releaseMs}@${LA_MIDNIGHT}`));
    });

    it("doesn't send again what quiet hours held: the held push's row claims it for its users", async () => {
      // notifyEvent writes the row even when the recipient's quiet hours hold the push.
      mocks.recipients = [{ id: 'u1', timeZone: 'Asia/Kolkata' }, { id: 'u2', timeZone: 'America/Los_Angeles' }];
      mocks.history = [{ dedupeKey: film(KOLKATA_MIDNIGHT), body: 'x', metadata: { recipientUserIds: ['u1'] } }];
      expect(keys(await run('checkUpcoming', SETTINGS, Date.parse('2026-10-19T18:20:00Z')))).toEqual([album(KOLKATA_MIDNIGHT)]);
    });

    it('does not send again what the UTC-midnight countdown or the digest already sent', async () => {
      // Sent under the zone-less key before this change (or by the digest).
      mocks.history = [
        { dedupeKey: `radarr-r1-50-cinema-${releaseMs}`, body: 'x', metadata: null },
        { dedupeKey: null, body: 'y', metadata: { grouped: true, itemDedupeKeys: [`lidarr-l1-90-${releaseMs}`] } },
      ];
      expect(sends(await run('checkUpcoming', LA, LA_23_15))).toEqual([]);
    });

    it('the digest does not send again what before-air sent, even from UTC+14 two days back', async () => {
      // Kiritimati's Nov 20 starts at 10:00Z on Nov 19; its push left at 09:00Z.
      // The Los Angeles digest at 23:00 on Nov 20 runs 46 h later.
      const day = Date.parse('2026-11-20T00:00:00Z');
      radarrCalendar.mockResolvedValue([{ id: 50, title: 'Film', year: 2026, inCinemas: '2026-11-20T00:00:00Z' }]);
      mocks.lidarr = [];
      mocks.history = [{
        dedupeKey: `radarr-r1-50-cinema-${day}@${Date.parse('2026-11-19T10:00:00Z')}`, body: 'x',
        metadata: { recipientUserIds: ['k1'] }, createdAt: new Date('2026-11-19T09:00:00Z'),
      }];
      const out = await run('checkUpcoming', { ...LA, upcomingNotifyMode: 'daily_digest', upcomingDailyNotifyHour: 23 }, Date.parse('2026-11-21T07:00:00Z'));
      expect(sends(out)).toEqual([]);
    });

    it('the digest does not send again what before-air sent at the extremes: UTC+14 send, UTC-12 digest at 23:59', async () => {
      // Kiritimati's push for Nov 20 left at 09:00Z on Nov 19; the digest in
      // UTC-12 at 23:59 on Nov 20 is 11:59Z on Nov 21, 50 h 59 min later.
      const day = Date.parse('2026-11-20T00:00:00Z');
      radarrCalendar.mockResolvedValue([{ id: 50, title: 'Film', year: 2026, inCinemas: '2026-11-20T00:00:00Z' }]);
      mocks.lidarr = [];
      mocks.history = [{
        dedupeKey: `radarr-r1-50-cinema-${day}@${Date.parse('2026-11-19T10:00:00Z')}`, body: 'x',
        metadata: { recipientUserIds: ['k1'] }, createdAt: new Date('2026-11-19T09:00:00Z'),
      }];
      const settings = { ...SETTINGS, timeZone: 'Etc/GMT+12', upcomingNotifyMode: 'daily_digest', upcomingDailyNotifyHour: 23 };
      expect(sends(await run('checkUpcoming', settings, Date.parse('2026-11-21T11:59:00Z')))).toEqual([]);
    });

    it('the digest does not send again what before-air sent', async () => {
      mocks.history = [{ dedupeKey: film(KOLKATA_MIDNIGHT), body: 'x', metadata: { recipientUserIds: ['u1'] } }];
      // 09:00 IST on Oct 20, the digest hour.
      const out = await run('checkUpcoming', { ...SETTINGS, upcomingNotifyMode: 'daily_digest' }, Date.parse('2026-10-20T03:30:00Z'));
      expect(sends(out)).toEqual([{ body: 'Band — Album', dedupeKey: `lidarr-l1-90-${releaseMs}` }]);
    });

    it('looks up recipients only when a film or album could fire now', async () => {
      const { usersWhoCouldReceive } = await import('@/lib/notification-service');
      const lookups = vi.mocked(usersWhoCouldReceive);
      lookups.mockClear();
      // No Radarr or Lidarr.
      mocks.radarr = [];
      mocks.lidarr = [];
      await run('checkUpcoming', SETTINGS, KOLKATA_23_15);
      expect(lookups).not.toHaveBeenCalled();
      // Releases a day and more away from any midnight that could be in the window.
      radarrCalendar.mockResolvedValue([{ id: 50, title: 'Film', year: 2026, inCinemas: '2026-10-22T00:00:00Z' }]);
      mocks.radarr = [{ connection: { id: 'r1', label: 'main', isDefault: true }, client: { getCalendar: radarrCalendar } }];
      await run('checkUpcoming', SETTINGS, KOLKATA_23_15);
      expect(lookups).not.toHaveBeenCalled();
      // One that could: one lookup per source per cycle.
      radarrCalendar.mockResolvedValue([
        { id: 50, title: 'Film', year: 2026, inCinemas: '2026-10-20T00:00:00Z' },
        { id: 51, title: 'Other', year: 2026, digitalRelease: '2026-10-20T00:00:00Z' },
      ]);
      await run('checkUpcoming', SETTINGS, KOLKATA_23_15);
      expect(lookups.mock.calls).toEqual([['upcomingPremiere', { source: 'radarr' }]]);
    });
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
