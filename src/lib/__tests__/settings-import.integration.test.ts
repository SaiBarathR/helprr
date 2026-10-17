import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// Runs the real settings import against a disposable PostgreSQL database that
// has every migration applied:
//   SETTINGS_IMPORT_TEST_DATABASE_URL=postgresql://…/helprr_import_test npx vitest run settings-import.integration
// Every table is truncated between tests, so the database must be named
// exactly helprr_import_test.
const url = process.env.SETTINGS_IMPORT_TEST_DATABASE_URL;

type RunImport = typeof import('@/lib/settings-import/run-import');

const IMPORTER_ID = 'importer-admin';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/import-test';
const future = () => new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

function watchlistItem(i: number, tags: string[] = ['favourites']) {
  return {
    source: 'TMDB', externalId: String(100_000 + i), mediaType: i % 2 ? 'movie' : 'series',
    title: `Title ${i}`, year: 2000 + (i % 25), posterUrl: `https://image.tmdb.org/t/p/w342/${i}.jpg`,
    overview: 'An overview.', rating: 70, addedAt: '2026-01-01T00:00:00.000Z', reminderAt: null, tags,
  };
}

function alert(i: number, scheduleMode: 'release_relative' | 'absolute' = 'release_relative') {
  return {
    source: 'TMDB', externalId: String(200_000 + i), mediaType: 'movie', instanceId: null,
    title: `Alert ${i}`, subtitle: null, posterUrl: null, href: `/movies/${i}`,
    scheduleMode, scope: 'movie', releaseTypes: ['digital'], offsetMinutes: 60, timeZone: 'UTC',
    metadata: { movieId: i }, absoluteNotifyAt: scheduleMode === 'absolute' ? future() : null,
  };
}

function mapping(i: number, entries = 1) {
  return {
    sonarrInstanceLabel: 'Sonarr Anime', sonarrSeriesId: 1 + i, state: 'MANUAL_MATCH', matchMethod: 'manual',
    confidence: 100, seriesTitleSnapshot: `Series ${i}`, seriesYearSnapshot: 2020, seriesTvdbIdSnapshot: 300_000 + i,
    seriesTmdbIdSnapshot: null,
    entries: Array.from({ length: entries }, (_, e) => ({
      anilistMediaId: 1_000_000 + i * 10 + e, isPrimary: e === 0, order: e, source: 'manual', titleSnapshot: `Season ${e + 1}`,
    })),
  };
}

/** Every section a full admin export can carry, small. */
function fullDocument() {
  return {
    appSettings: { pollingIntervalSecs: 45, timeZone: 'Europe/Berlin', logLevel: 'info' },
    serviceConnections: [
      { type: 'SONARR', label: 'Sonarr Anime', url: 'http://sonarr:8989', apiKey: 'sonarr-key', isDefault: true },
      { type: 'QBITTORRENT', label: 'qBittorrent', url: 'http://qbit:8080', apiKey: 'qbit-password', username: 'admin' },
    ],
    notificationDevice: { deviceName: 'Phone', rules: [{ eventType: 'grabbed', enabled: true, tagFilter: null, qualityFilter: null, mutedUserFilter: null }] },
    currentDeviceEndpoint: ENDPOINT,
    cleanup: {
      queueConfig: { enabled: false, intervalMinutes: 30, ignoredDownloads: [], autoRunMode: 'disabled' },
      downloadConfig: { enabled: false, intervalMinutes: 60, ignoredDownloads: [], autoRunMode: 'disabled' },
      stallRules: [{ name: 'Stalled', enabled: true, priority: 0, maxStrikes: 3, privacyType: 'both' }],
      slowRules: [{ name: 'Slow', enabled: true, priority: 0, maxStrikes: 3, privacyType: 'both', minSpeedKbps: 50 }],
      seedingRules: [{ name: 'Seeded', enabled: true, priority: 0, categories: ['radarr'], privacyType: 'both', maxRatio: 2 }],
    },
    dashboardLayouts: {
      layouts: [{ name: 'Wall', isBuiltIn: false, slug: null, widgets: [] }],
      defaultDesktopLayoutName: null, defaultMobileLayoutName: null,
    },
    scheduledAlerts: { alerts: [alert(1), alert(2, 'absolute')] },
    watchlist: { items: [watchlistItem(1), watchlistItem(2, [])], tags: [{ name: 'favourites', color: '#ff0000' }] },
    animeMappings: { mappings: [mapping(1, 2)] },
    users: {
      accounts: [{
        id: 'member-1', username: 'member', displayName: 'Member', role: 'member', status: 'active', template: 'member',
        permissions: {}, jellyfinUserId: null, seerrUserId: null, settings: null, anilist: null,
        watchlist: { items: [watchlistItem(3)], tags: [] }, scheduledAlerts: [alert(3)], dashboardLayouts: [],
      }],
    },
  };
}

describe.skipIf(!url)('settings import against PostgreSQL', () => {
  let prisma: PrismaClient;
  let runImport: RunImport;

  async function reset() {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    await prisma.user.create({ data: { id: IMPORTER_ID, username: 'importer', displayName: 'Importer', role: 'admin', template: 'admin' } });
    await prisma.pushSubscription.create({ data: { userId: IMPORTER_ID, endpoint: ENDPOINT, p256dh: 'k', auth: 'a' } });
  }

  /** Rows the import writes, per table, beyond what reset() seeds. */
  async function written() {
    const [appSettings, services, prefs, stall, layouts, alerts, watchlist, mappings, users] = await Promise.all([
      prisma.appSettings.count(), prisma.serviceConnection.count(), prisma.notificationPreference.count(),
      prisma.stallRule.count(), prisma.dashboardLayout.count(), prisma.scheduledAlert.count(),
      prisma.watchlistItem.count(), prisma.aniListSeriesMapping.count(), prisma.user.count(),
    ]);
    return { appSettings, services, prefs, stall, layouts, alerts, watchlist, mappings, users: users - 1 };
  }

  beforeAll(async () => {
    if (new URL(url!).pathname !== '/helprr_import_test') {
      throw new Error('SETTINGS_IMPORT_TEST_DATABASE_URL must name the database helprr_import_test');
    }
    vi.stubEnv('DATABASE_URL', url!);
    ({ prisma } = await import('@/lib/db'));
    runImport = await import('@/lib/settings-import/run-import');
  });
  beforeEach(reset);
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  it('restores every section of a full export, and a second import changes nothing', async () => {
    const first = await runImport.applySettingsImport(fullDocument() as never, IMPORTER_ID);
    expect(first.applied).toMatchObject({
      appSettings: true, services: ['SONARR', 'QBITTORRENT'], notificationRules: 1, cleanup: true,
      dashboardLayouts: 1, watchlistItems: 2, scheduledAlerts: 2, animeMappings: 1, users: 1,
    });
    const after = await written();
    expect(after).toEqual({ appSettings: 1, services: 2, prefs: 1, stall: 1, layouts: 1, alerts: 3, watchlist: 3, mappings: 1, users: 1 });
    expect(await prisma.aniListSeriesMappingEntry.count()).toBe(2);
    expect(await prisma.scheduledAlertOccurrence.count()).toBe(1);
    expect(first.followUps.alertIds).toHaveLength(2);

    await runImport.applySettingsImport(fullDocument() as never, IMPORTER_ID);
    expect(await written()).toEqual(after);
    expect(await prisma.aniListSeriesMappingEntry.count()).toBe(2);
  });

  it('keeps what one upsert per row did: merged tags, kept values, first alert, replaced entries', async () => {
    const tagLinks = async () => Number((await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "_WatchlistItemTags"`)[0].n);
    const doc = {
      watchlist: {
        items: [watchlistItem(1, ['a']), { ...watchlistItem(1, ['b']), title: 'Renamed' }, watchlistItem(2, [])],
        tags: [{ name: 'a', color: '#111111' }],
      },
      scheduledAlerts: { alerts: [alert(1), { ...alert(1), title: 'Duplicate' }, alert(2, 'absolute')] },
      serviceConnections: [{ type: 'SONARR', label: 'Sonarr Anime', url: 'http://sonarr:8989', apiKey: 'k', isDefault: true }],
      animeMappings: { mappings: [mapping(1, 3)] },
    };
    const first = await runImport.applySettingsImport(doc as never, IMPORTER_ID);

    // A later duplicate item wins and its tags join the earlier one's.
    expect(first.applied).toMatchObject({ watchlistItems: 2, scheduledAlerts: 2, animeMappings: 1 });
    const item = await prisma.watchlistItem.findFirstOrThrow({ where: { externalId: '100001' }, include: { tags: true } });
    expect(item.title).toBe('Renamed');
    expect(item.tags.map((t) => t.name).sort()).toEqual(['a', 'b']);
    expect((await prisma.watchlistTag.findFirstOrThrow({ where: { name: 'a' } })).color).toBe('#111111');
    // The first of two identical alerts is kept, and the absolute one has its occurrence.
    expect((await prisma.scheduledAlert.findMany({ orderBy: { title: 'asc' } })).map((a) => a.title)).toEqual(['Alert 1', 'Alert 2']);
    expect(await prisma.scheduledAlertOccurrence.count()).toBe(1);
    expect(await tagLinks()).toBe(2);

    // Re-import: no new rows or links; an item's stored values survive fields the
    // file leaves empty, its reminder is re-armed, and mapping entries are replaced.
    await prisma.watchlistItem.update({ where: { id: item.id }, data: { reminderNotifiedAt: new Date() } });
    await runImport.applySettingsImport({
      ...doc,
      watchlist: { items: [{ ...watchlistItem(1, ['a']), title: 'Again', posterUrl: null, overview: null }], tags: [] },
      animeMappings: { mappings: [mapping(1, 1)] },
    } as never, IMPORTER_ID);
    const again = await prisma.watchlistItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(again).toMatchObject({ title: 'Again', posterUrl: item.posterUrl, overview: item.overview, reminderNotifiedAt: null });
    expect(await prisma.watchlistItem.count()).toBe(2);
    expect(await tagLinks()).toBe(2);
    expect(await prisma.scheduledAlert.count()).toBe(2);
    expect(await prisma.aniListSeriesMappingEntry.count()).toBe(1);
  });

  // Each domain in turn fails after the ones before it have written: the whole
  // import must roll back.
  it.each([
    ['app settings', () => import('@/lib/settings-import/app-settings'), 'applyAppSettingsInTxn'],
    ['services', () => import('@/lib/settings-import/services'), 'applyServiceConnectionInTxn'],
    ['notifications', () => import('@/lib/settings-import/notifications'), 'applyNotificationDeviceInTxn'],
    ['cleanup', () => import('@/lib/settings-import/cleanup'), 'applyCleanupInTxn'],
    ['layouts', () => import('@/lib/settings-import/layouts'), 'applyDashboardLayoutsInTxn'],
    ['alerts', () => import('@/lib/settings-import/alerts'), 'applyPreparedScheduledAlerts'],
    ['watchlist', () => import('@/lib/settings-import/watchlist'), 'applyPreparedWatchlist'],
    ['anime mappings', () => import('@/lib/settings-import/anime-mappings'), 'applyPreparedAnimeMappings'],
    ['users', () => import('@/lib/settings-import/users'), 'applyUsersInTxn'],
  ] as const)('a failure in %s leaves nothing behind', async (_name, load, fn) => {
    const section = await load();
    vi.spyOn(section as unknown as Record<string, () => Promise<unknown>>, fn).mockRejectedValueOnce(new Error('injected failure'));

    await expect(runImport.applySettingsImport(fullDocument() as never, IMPORTER_ID)).rejects.toThrow('injected failure');

    expect(await written()).toEqual({ appSettings: 0, services: 0, prefs: 0, stall: 0, layouts: 0, alerts: 0, watchlist: 0, mappings: 0, users: 0 });
  });

  it('imports a document at the size limits within the transaction timeout', async () => {
    const { validateSettingsImportComplexity } = await import('@/lib/settings-import-validation');
    const doc = {
      ...fullDocument(),
      watchlist: { items: Array.from({ length: 1700 }, (_, i) => watchlistItem(i, ['a', 'b'])), tags: [] },
      scheduledAlerts: { alerts: Array.from({ length: 800 }, (_, i) => alert(i)) },
      animeMappings: { mappings: Array.from({ length: 900 }, (_, i) => mapping(i)) },
    };
    expect(validateSettingsImportComplexity(doc)).toBeNull();

    const started = performance.now();
    const outcome = await runImport.applySettingsImport(doc as never, IMPORTER_ID);
    const firstMs = performance.now() - started;
    const again = performance.now();
    await runImport.applySettingsImport(doc as never, IMPORTER_ID);
    const secondMs = performance.now() - again;
    console.log(`[benchmark] near-limit import: ${Math.round(firstMs)} ms into an empty database, ${Math.round(secondMs)} ms re-imported`);

    expect(outcome.applied).toMatchObject({ watchlistItems: 1700, scheduledAlerts: 800, animeMappings: 900 });
  }, 120_000);
});
