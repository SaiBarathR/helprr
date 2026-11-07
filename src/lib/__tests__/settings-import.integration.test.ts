import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// Runs the real settings import against a disposable PostgreSQL database that
// has every migration applied:
//   SETTINGS_IMPORT_TEST_DATABASE_URL=postgresql://…/helprr_import_test npx vitest run settings-import.integration
// Every table is truncated between tests, so the database must be named
// exactly helprr_import_test.
const url = process.env.SETTINGS_IMPORT_TEST_DATABASE_URL;

type RunImport = typeof import('@/lib/settings-import/run-import');

// Only the export route asks; the import is called directly.
vi.mock('@/lib/auth', () => ({
  requireUserCapability: vi.fn(async () => ({
    ok: true,
    user: { id: 'importer-admin', username: 'importer', displayName: 'Importer', role: 'admin', status: 'active', template: 'admin', permissions: {} },
  })),
}));

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

const CHANNEL = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const PLAYLIST = 'PLbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const channelId = (i: number) => `UC${String(i).padStart(22, '0')}`;
const playlistId = (i: number) => `PL${String(i).padStart(32, '0')}`;

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
    youtube: {
      settings: { autoDownloadEnabled: true, pollVideosSecs: 900 },
      subscriptions: [{ channelId: CHANNEL, login: 'somebody', folderName: 'somebody', displayName: 'Somebody', notifyNewVods: true }],
      playlists: [{ playlistId: PLAYLIST, title: 'Mix', notifyNewVideos: true }],
    },
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
    const [appSettings, services, prefs, stall, layouts, alerts, watchlist, mappings, users, youtube] = await Promise.all([
      prisma.appSettings.count(), prisma.serviceConnection.count(), prisma.notificationPreference.count(),
      prisma.stallRule.count(), prisma.dashboardLayout.count(), prisma.scheduledAlert.count(),
      prisma.watchlistItem.count(), prisma.aniListSeriesMapping.count(), prisma.user.count(),
      prisma.creatorPlaylistSubscription.count(),
    ]);
    return { appSettings, services, prefs, stall, layouts, alerts, watchlist, mappings, users: users - 1, youtube };
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
      youtubeSubscriptions: 1, youtubePlaylists: 1,
    });
    const after = await written();
    expect(after).toEqual({ appSettings: 1, services: 2, prefs: 1, stall: 1, layouts: 1, alerts: 3, watchlist: 3, mappings: 1, users: 1, youtube: 1 });
    expect(await prisma.aniListSeriesMappingEntry.count()).toBe(2);
    expect(await prisma.scheduledAlertOccurrence.count()).toBe(1);
    expect(first.followUps.alertIds).toHaveLength(2);

    await runImport.applySettingsImport(fullDocument() as never, IMPORTER_ID);
    expect(await written()).toEqual(after);
    expect(await prisma.aniListSeriesMappingEntry.count()).toBe(2);
  });

  it('restores Twitch settings, rules and subscriptions, and refuses a bad channel or a plain token', async () => {
    const doc = {
      twitch: {
        settings: {
          autoDownloadEnabled: true,
          defaultPolicy: { quality: '720p60', evil: true },
          keepOriginalDays: 9,
          reencodeWindowStart: '25:99',
          pinnedTools: { ytdlp: '2026.10.21', bad: '1', td: '../x' },
        },
        browserAuthToken: 'plain-token',
        subscriptions: [
          { twitchUserId: '123', login: 'somebody', displayName: 'Somebody', notifyNewVods: false, policy: { keepLatest: 5 } },
          { twitchUserId: '456', login: '../../etc', displayName: 'Bad', notifyNewVods: true },
        ],
      },
    };
    const first = await runImport.applySettingsImport(doc as never, IMPORTER_ID);

    expect(first.applied.twitchSubscriptions).toBe(1);
    expect(first.skipped).toContain('Twitch: subscription with an invalid channel');
    const settings = await prisma.archiveSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
    expect(settings).toMatchObject({
      autoDownloadEnabled: true, defaultPolicy: { quality: '720p60' }, keepOriginalDays: 9,
      reencodeWindowStart: '01:00', pinnedTools: { ytdlp: '2026.10.21' }, browserAuthToken: null,
    });
    const streamer = await prisma.creator.findUniqueOrThrow({ where: { platform_externalId: { platform: 'TWITCH', externalId: '123' } }, include: { policy: true, subscriptions: true } });
    expect(streamer.folderName).toBe('somebody');
    expect(streamer.subscriptions).toMatchObject([{ userId: IMPORTER_ID, notifyNewVods: false }]);
    expect(streamer.policy?.policy).toEqual({ keepLatest: 5 });

    await runImport.applySettingsImport(doc as never, IMPORTER_ID);
    expect(await prisma.creatorSubscription.count()).toBe(1);
  });

  it('never exports a two-step sign-in secret or recovery code, even with secrets included, and an import leaves it off', async () => {
    const { validateImportFile } = await import('@/lib/settings-export');
    const { POST: exportSettings } = await import('@/app/api/settings/export/route');
    const { NextRequest } = await import('next/server');
    await prisma.user.create({
      data: {
        id: 'mfa-user', username: 'mfauser', displayName: 'MFA', passwordHash: 'scrypt-hash-value',
        totpSecret: 'enc:v1:totp-secret-value', totpEnabledAt: new Date(), totpLastUsedStep: 12345,
        recoveryCodes: { create: [{ codeHash: 'recovery-code-hash-value' }] },
      },
    });

    const response = await exportSettings(new NextRequest('http://localhost/api/settings/export', {
      method: 'POST',
      body: JSON.stringify({ users: true, includeSecrets: true }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('mfauser');
    for (const leak of ['totp-secret-value', 'recovery-code-hash-value', 'totpSecret', 'totpEnabledAt', 'totpLastUsedStep', 'recoveryCodes', 'codeHash']) {
      expect(text).not.toContain(leak);
    }
    const file = validateImportFile(JSON.parse(text));
    if (!file.ok) throw new Error(file.error);

    await reset();
    await runImport.applySettingsImport({ users: file.payload.users } as never, IMPORTER_ID);
    expect(await prisma.user.findUniqueOrThrow({ where: { username: 'mfauser' } })).toMatchObject({
      totpSecret: null, totpEnabledAt: null, totpLastUsedStep: null,
    });
    expect(await prisma.recoveryCode.count()).toBe(0);
  });

  it('carries notification channels with each account: only the exporter\'s secrets, kept on a re-import without them', async () => {
    vi.stubEnv('JWT_SECRET', 'settings-import-test-secret-long-enough-for-aes');
    const { validateImportFile } = await import('@/lib/settings-export');
    const { POST: exportSettings } = await import('@/app/api/settings/export/route');
    const { encryptSecrets, decryptSecrets } = await import('@/lib/notification-channels/config');
    const { NextRequest } = await import('next/server');
    await prisma.user.create({ data: { id: 'member-ch', username: 'chmember', displayName: 'Member', role: 'member', template: 'member' } });
    await prisma.notificationChannel.create({
      data: {
        userId: 'member-ch', type: 'ntfy', name: 'Phone', events: ['imported', 'healthWarning'],
        config: { serverUrl: 'https://ntfy.sh', priority: '3' },
        secrets: encryptSecrets({ topic: 'member-topic-value', token: 'tk_member_value' }),
      },
    });
    await prisma.notificationChannel.create({
      data: {
        userId: IMPORTER_ID, type: 'webhook', name: 'Home Assistant', events: ['securityAlert'],
        config: { headerName: 'X-Helprr-Secret' },
        secrets: encryptSecrets({ url: 'http://192.168.1.10:8123/api/webhook/admin-hook-id', headerValue: 'admin-header-value' }),
      },
    });
    const exportUsers = async (includeSecrets: boolean) => {
      const response = await exportSettings(new NextRequest('http://localhost/api/settings/export', {
        method: 'POST',
        body: JSON.stringify({ users: true, includeSecrets }),
        headers: { 'content-type': 'application/json' },
      }));
      expect(response.status).toBe(200);
      return response.text();
    };

    const plain = await exportUsers(false);
    expect(plain).toContain('"name":"Phone"');
    for (const leak of ['member-topic-value', 'tk_member_value', 'admin-hook-id', 'admin-header-value', 'enc:v1']) {
      expect(plain).not.toContain(leak);
    }
    // With secrets included: the exporter's own, never another person's.
    const withSecrets = await exportUsers(true);
    expect(withSecrets).toContain('admin-hook-id');
    expect(withSecrets).not.toContain('member-topic-value');
    expect(withSecrets).not.toContain('tk_member_value');
    expect(withSecrets).not.toContain('enc:v1');

    const full = validateImportFile(JSON.parse(withSecrets));
    const bare = validateImportFile(JSON.parse(plain));
    if (!full.ok || !bare.ok) throw new Error('invalid export');

    // A fresh install: a channel without its secrets cannot be rebuilt, so it is skipped and said so.
    await reset();
    const fresh = await runImport.applySettingsImport({ users: full.payload.users } as never, IMPORTER_ID);
    expect(fresh.skipped.some((line) => line.includes('notification channel "Phone" skipped'))).toBe(true);
    const hook = await prisma.notificationChannel.findFirstOrThrow({ where: { name: 'Home Assistant' } });
    expect(hook).toMatchObject({ userId: IMPORTER_ID, type: 'webhook', events: ['securityAlert'] });
    expect(decryptSecrets(hook.secrets)).toEqual({ url: 'http://192.168.1.10:8123/api/webhook/admin-hook-id', headerValue: 'admin-header-value' });
    expect(await prisma.notificationChannel.count()).toBe(1);

    // The same install: the member's channel is still there, and a file without secrets keeps them.
    await prisma.notificationChannel.create({
      data: {
        userId: 'member-ch', type: 'ntfy', name: 'Phone', events: [],
        config: { serverUrl: 'https://ntfy.sh', priority: '3' },
        secrets: encryptSecrets({ topic: 'member-topic-value', token: 'tk_member_value' }),
      },
    });
    await runImport.applySettingsImport({ users: bare.payload.users } as never, IMPORTER_ID);
    const phone = await prisma.notificationChannel.findFirstOrThrow({ where: { name: 'Phone' } });
    expect(phone.events).toEqual(['imported']); // a member gets no health alerts
    expect(decryptSecrets(phone.secrets)).toEqual({ topic: 'member-topic-value', token: 'tk_member_value' });
    expect(decryptSecrets((await prisma.notificationChannel.findFirstOrThrow({ where: { name: 'Home Assistant' } })).secrets))
      .toEqual({ url: 'http://192.168.1.10:8123/api/webhook/admin-hook-id', headerValue: 'admin-header-value' });
    expect(await prisma.notificationChannel.count()).toBe(2);
  });

  it('round-trips YouTube settings, rules and follows through export and import, without the cookies or the cleanup viewer', async () => {
    const { validateImportFile } = await import('@/lib/settings-export');
    const { POST: exportSettings } = await import('@/app/api/settings/export/route');
    const { NextRequest } = await import('next/server');
    await prisma.youtubeSettings.create({
      data: {
        id: 'singleton', autoDownloadEnabled: true, defaultPolicy: { quality: '1080p' }, typePolicies: { SHORT: { autoDownload: false } },
        jellyfinLibraryPath: '/media/youtube', jellyfinLibraryItemId: 'jf-lib', pollVideosSecs: 1800,
        cookies: 'enc:v1:cookie-secret', autoCleanupEnabled: true, cleanupJellyfinUserId: 'jf-viewer', cleanupConnectionId: 'conn-1',
      },
    });
    const channel = await prisma.creator.create({
      data: { platform: 'YOUTUBE', externalId: CHANNEL, login: 'somebody', folderName: 'somebody-aaaaaa', displayName: 'Somebody', baselinedAt: new Date() },
    });
    await prisma.creatorPolicy.create({ data: { creatorId: channel.id, policy: { keepLatest: 5 }, typePolicies: { UPLOAD: { quality: '720p' } } } });
    await prisma.creatorSubscription.create({ data: { userId: IMPORTER_ID, creatorId: channel.id, notifyNewVods: false } });
    const playlist = await prisma.creatorPlaylist.create({ data: { platform: 'YOUTUBE', externalId: PLAYLIST, title: 'Mix', baselinedAt: new Date() } });
    await prisma.creatorPlaylistSubscription.create({ data: { userId: IMPORTER_ID, playlistId: playlist.id, notifyNewVideos: false } });

    const response = await exportSettings(new NextRequest('http://localhost/api/settings/export', {
      method: 'POST',
      body: JSON.stringify({ youtube: true, includeSecrets: true }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('cookie-secret');
    expect(text).not.toContain('jf-viewer');
    const file = validateImportFile(JSON.parse(text));
    if (!file.ok) throw new Error(file.error);

    await reset();
    const outcome = await runImport.applySettingsImport({ youtube: file.payload.youtube } as never, IMPORTER_ID);

    expect(outcome.applied).toMatchObject({ youtubeSubscriptions: 1, youtubePlaylists: 1 });
    expect(outcome.skipped).toEqual([]);
    expect(await prisma.youtubeSettings.findUniqueOrThrow({ where: { id: 'singleton' } })).toMatchObject({
      autoDownloadEnabled: true, defaultPolicy: { quality: '1080p' }, typePolicies: { SHORT: { autoDownload: false } },
      jellyfinLibraryPath: '/media/youtube', pollVideosSecs: 1800,
      cookies: null, autoCleanupEnabled: false, cleanupJellyfinUserId: null, cleanupConnectionId: null,
    });
    const restored = await prisma.creator.findUniqueOrThrow({
      where: { platform_externalId: { platform: 'YOUTUBE', externalId: CHANNEL } },
      include: { policy: true, subscriptions: true },
    });
    // The folder the files already live in, and a silent first sweep.
    expect(restored).toMatchObject({ login: 'somebody', folderName: 'somebody-aaaaaa', displayName: 'Somebody', baselinedAt: null });
    expect(restored.subscriptions).toMatchObject([{ userId: IMPORTER_ID, notifyNewVods: false }]);
    expect(restored.policy).toMatchObject({ policy: { keepLatest: 5 }, typePolicies: { UPLOAD: { quality: '720p' } } });
    const list = await prisma.creatorPlaylist.findUniqueOrThrow({
      where: { platform_externalId: { platform: 'YOUTUBE', externalId: PLAYLIST } },
      include: { subscriptions: true },
    });
    expect(list).toMatchObject({ title: 'Mix', baselinedAt: null });
    expect(list.subscriptions).toMatchObject([{ userId: IMPORTER_ID, notifyNewVideos: false }]);

    await runImport.applySettingsImport({ youtube: file.payload.youtube } as never, IMPORTER_ID);
    expect(await prisma.creator.count()).toBe(1);
    expect(await prisma.creatorSubscription.count()).toBe(1);
    expect(await prisma.creatorPlaylistSubscription.count()).toBe(1);
  });

  it('holds a hostile YouTube section to what following by hand allows', async () => {
    // Another channel already has the folder the file names.
    await prisma.creator.create({ data: { platform: 'YOUTUBE', externalId: channelId(9), login: 'taken', folderName: 'taken', displayName: 'Taken' } });
    // Known but unwatched: what it published meanwhile is history, not news.
    const unwatched = await prisma.creator.create({
      data: { platform: 'YOUTUBE', externalId: channelId(2), login: 'quiet', folderName: 'quiet', displayName: 'Quiet', baselinedAt: new Date(), nextVideosCheckAt: new Date() },
    });
    await prisma.creatorVideo.create({
      data: { platform: 'YOUTUBE', externalId: 'aaaaaaaaaaa', creatorId: unwatched.id, type: 'UPLOAD', title: 'Old', sourceCreatedAt: new Date(), durationSeconds: 60 },
    });
    await prisma.youtubeSettings.create({ data: { id: 'singleton', cookies: 'enc:v1:keep-me', cleanupGeneration: 4 } });
    const job = await prisma.archiveJob.create({ data: { platform: 'YOUTUBE', kind: 'DELETE_FILES', requestedByUsername: 'Automatic cleanup' } });

    const outcome = await runImport.applySettingsImport({
      youtube: {
        settings: {
          autoDownloadEnabled: 'yes', defaultPolicy: { quality: '720p', evil: true }, jellyfinLibraryPath: '/media/../etc',
          pollVideosSecs: 5, cookies: 'plain-cookies', autoCleanupEnabled: true, cleanupJellyfinUserId: 'someone',
        },
        subscriptions: [
          { channelId: '../../etc', login: 'x', folderName: 'x' },
          { channelId: channelId(1), login: 'Evil Handle!', folderName: '../../etc', displayName: 'x'.repeat(500) },
          { channelId: channelId(3), login: 'taken', folderName: 'taken' },
          { channelId: channelId(2), login: 'quiet', folderName: 'quiet' },
        ],
        playlists: [
          { playlistId: 'not a playlist', title: 'Bad' },
          { playlistId: playlistId(1), title: 'y'.repeat(500), notifyNewVideos: 'no' },
        ],
      },
    } as never, IMPORTER_ID);

    expect(outcome.applied).toMatchObject({ youtubeSubscriptions: 3, youtubePlaylists: 1 });
    expect(outcome.skipped).toEqual(['YouTube: subscription with an invalid channel', 'YouTube: playlist with an invalid id']);
    expect(await prisma.youtubeSettings.findUniqueOrThrow({ where: { id: 'singleton' } })).toMatchObject({
      autoDownloadEnabled: false, jellyfinLibraryPath: null, pollVideosSecs: 600,
      cookies: 'enc:v1:keep-me', autoCleanupEnabled: false, cleanupJellyfinUserId: null, cleanupGeneration: 5,
    });
    expect((await prisma.youtubeSettings.findUniqueOrThrow({ where: { id: 'singleton' } })).defaultPolicy).toEqual({ quality: '720p' });
    const folder = async (i: number) => (await prisma.creator.findUniqueOrThrow({
      where: { platform_externalId: { platform: 'YOUTUBE', externalId: channelId(i) } },
    }));
    // An unsafe folder or handle falls back to the channel id, and a taken folder gets the suffix.
    expect(await folder(1)).toMatchObject({ login: channelId(1), folderName: channelId(1).toLowerCase(), displayName: 'x'.repeat(100) });
    expect((await folder(3)).folderName).toBe(`taken-${channelId(3).slice(-6)}`);
    expect(await folder(2)).toMatchObject({ folderName: 'quiet', baselinedAt: null, nextVideosCheckAt: null });
    expect((await prisma.creatorVideo.findFirstOrThrow({ where: { creatorId: unwatched.id } })).notifiedAt).not.toBeNull();
    const list = await prisma.creatorPlaylist.findFirstOrThrow({ include: { subscriptions: true } });
    expect(list.title).toHaveLength(200);
    expect(list.subscriptions).toMatchObject([{ notifyNewVideos: true }]);
    // A cleanup delete queued under the old rules must not run.
    expect((await prisma.archiveJob.findUniqueOrThrow({ where: { id: job.id } })).state).toBe('CANCELLED');
  });

  it("keeps this install's YouTube settings when the file has none, and its library id while the path is the same", async () => {
    await prisma.youtubeSettings.create({
      data: { id: 'singleton', autoDownloadEnabled: true, pollVideosSecs: 1200, jellyfinLibraryPath: '/media/youtube', jellyfinLibraryItemId: 'jf-lib' },
    });
    const settings = () => prisma.youtubeSettings.findUniqueOrThrow({ where: { id: 'singleton' } });

    await runImport.applySettingsImport({ youtube: { subscriptions: [], playlists: [] } } as never, IMPORTER_ID);
    expect(await settings()).toMatchObject({ autoDownloadEnabled: true, pollVideosSecs: 1200, jellyfinLibraryItemId: 'jf-lib' });

    await runImport.applySettingsImport({ youtube: { settings: { jellyfinLibraryPath: '/media/youtube' } } } as never, IMPORTER_ID);
    expect(await settings()).toMatchObject({ autoDownloadEnabled: false, jellyfinLibraryItemId: 'jf-lib' });

    // That id names the library at the old path.
    await runImport.applySettingsImport({ youtube: { settings: { jellyfinLibraryPath: '/media/other' } } } as never, IMPORTER_ID);
    expect(await settings()).toMatchObject({ jellyfinLibraryPath: '/media/other', jellyfinLibraryItemId: null });
  });

  it('leaves YouTube alone when an older export without the section is imported', async () => {
    const { validateImportFile } = await import('@/lib/settings-export');
    await prisma.youtubeSettings.create({ data: { id: 'singleton', autoDownloadEnabled: true, pollVideosSecs: 1200, cleanupGeneration: 2 } });
    const older: Partial<ReturnType<typeof fullDocument>> = fullDocument();
    delete older.youtube;
    const file = validateImportFile({ kind: 'helprr-settings-export', version: 2, zustandVersion: 0, ...older });
    if (!file.ok) throw new Error(file.error);

    const outcome = await runImport.applySettingsImport(file.payload as never, IMPORTER_ID);

    expect(outcome.applied).toMatchObject({ users: 1, youtubeSubscriptions: 0, youtubePlaylists: 0 });
    expect(await prisma.youtubeSettings.findUniqueOrThrow({ where: { id: 'singleton' } })).toMatchObject({
      autoDownloadEnabled: true, pollVideosSecs: 1200, cleanupGeneration: 2,
    });
  });

  it('imports as many YouTube follows as the section limits allow within the transaction timeout', async () => {
    const { IMPORT_SECTION_LIMITS, validateImportSectionLimits } = await import('@/lib/settings-import/limits');
    const doc = {
      youtube: {
        subscriptions: Array.from({ length: IMPORT_SECTION_LIMITS.youtubeChannels }, (_, i) => ({
          channelId: channelId(i), login: `channel${i}`, folderName: `channel${i}`, displayName: `Channel ${i}`, notifyNewVods: true,
          policy: { keepLatest: 5 },
        })),
        playlists: Array.from({ length: IMPORT_SECTION_LIMITS.youtubePlaylists }, (_, i) => ({ playlistId: playlistId(i), title: `List ${i}`, notifyNewVideos: true })),
      },
    };
    expect(validateImportSectionLimits(doc as never)).toBeNull();

    const started = performance.now();
    const outcome = await runImport.applySettingsImport(doc as never, IMPORTER_ID);
    const firstMs = performance.now() - started;
    const again = performance.now();
    await runImport.applySettingsImport(doc as never, IMPORTER_ID);
    console.log(`[benchmark] YouTube follows at the limits: ${Math.round(firstMs)} ms created, ${Math.round(performance.now() - again)} ms re-imported`);

    expect(outcome.applied).toMatchObject({
      youtubeSubscriptions: IMPORT_SECTION_LIMITS.youtubeChannels, youtubePlaylists: IMPORT_SECTION_LIMITS.youtubePlaylists,
    });
  }, 180_000);

  it('keeps what one upsert per row did: merged tags, kept values, first alert, replaced entries', async () => {
    const tagLinks = async () => Number((await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "_WatchlistItemTags"`)[0].n);
    const doc = {
      watchlist: {
        items: [
          { ...watchlistItem(1, ['a']), addedAt: '2020-01-01T00:00:00.000Z' },
          // A later duplicate: its title wins, its empty poster/overview/rating do not, nor does its addedAt.
          { ...watchlistItem(1, ['b']), title: 'Renamed', posterUrl: null, overview: null, rating: null, addedAt: '2024-01-01T00:00:00.000Z' },
          watchlistItem(2, []),
        ],
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
    expect(item).toMatchObject({
      title: 'Renamed', posterUrl: 'https://image.tmdb.org/t/p/w342/1.jpg', overview: 'An overview.', rating: 70,
      addedAt: new Date('2020-01-01T00:00:00.000Z'),
    });
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
      watchlist: {
        items: [
          { ...watchlistItem(1, ['a']), posterUrl: 'https://image.tmdb.org/t/p/w342/new.jpg', overview: null },
          { ...watchlistItem(1, ['a']), title: 'Again', posterUrl: null, overview: null, addedAt: '2025-01-01T00:00:00.000Z' },
        ],
        tags: [],
      },
      animeMappings: { mappings: [mapping(1, 1)] },
    } as never, IMPORTER_ID);
    const again = await prisma.watchlistItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(again).toMatchObject({
      title: 'Again', posterUrl: 'https://image.tmdb.org/t/p/w342/new.jpg', overview: item.overview,
      addedAt: item.addedAt, reminderNotifiedAt: null,
    });
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
    ['youtube', () => import('@/lib/settings-import/youtube'), 'applyYoutubeInTxn'],
    ['layouts', () => import('@/lib/settings-import/layouts'), 'applyDashboardLayoutsInTxn'],
    ['alerts', () => import('@/lib/settings-import/alerts'), 'applyPreparedScheduledAlerts'],
    ['watchlist', () => import('@/lib/settings-import/watchlist'), 'applyPreparedWatchlist'],
    ['anime mappings', () => import('@/lib/settings-import/anime-mappings'), 'applyPreparedAnimeMappings'],
    ['users', () => import('@/lib/settings-import/users'), 'applyUsersInTxn'],
  ] as const)('a failure in %s leaves nothing behind', async (_name, load, fn) => {
    const section = await load();
    vi.spyOn(section as unknown as Record<string, () => Promise<unknown>>, fn).mockRejectedValueOnce(new Error('injected failure'));

    await expect(runImport.applySettingsImport(fullDocument() as never, IMPORTER_ID)).rejects.toThrow('injected failure');

    expect(await written()).toEqual({ appSettings: 0, services: 0, prefs: 0, stall: 0, layouts: 0, alerts: 0, watchlist: 0, mappings: 0, users: 0, youtube: 0 });
    expect(await prisma.creator.count()).toBe(0);
    expect(await prisma.youtubeSettings.count()).toBe(0);
  });

  it("restores a user's date and time format, treating unknown or missing values as automatic", async () => {
    const doc = fullDocument();
    doc.users.accounts[0].settings = {
      timeZone: null, upcomingNotifyMode: null, activityDigestMode: null,
      quietHoursEnabled: false, quietHoursStart: null, quietHoursEnd: null,
      timeFormat: '24h', dateFormat: 'bogus',
    } as never;
    await runImport.applySettingsImport(doc as never, IMPORTER_ID);
    expect(await prisma.userSettings.findUnique({ where: { userId: 'member-1' }, select: { timeFormat: true, dateFormat: true } }))
      .toEqual({ timeFormat: '24h', dateFormat: null });

    // An export from before the preference existed resets it to automatic.
    doc.users.accounts[0].settings = {
      timeZone: null, upcomingNotifyMode: null, activityDigestMode: null,
      quietHoursEnabled: false, quietHoursStart: null, quietHoursEnd: null,
    } as never;
    await runImport.applySettingsImport(doc as never, IMPORTER_ID);
    expect(await prisma.userSettings.findUnique({ where: { userId: 'member-1' }, select: { timeFormat: true, dateFormat: true } }))
      .toEqual({ timeFormat: null, dateFormat: null });
  });

  it("restores a user's New episode window, defaulting to 14 days for older or invalid values", async () => {
    const doc = fullDocument();
    const base = {
      timeZone: null, upcomingNotifyMode: null, activityDigestMode: null,
      quietHoursEnabled: false, quietHoursStart: null, quietHoursEnd: null,
    };
    const days = async () => (await prisma.userSettings.findUnique({ where: { userId: 'member-1' }, select: { watchingEpisodeDays: true } }))?.watchingEpisodeDays;
    doc.users.accounts[0].settings = { ...base, watchingEpisodeDays: 0 } as never;
    await runImport.applySettingsImport(doc as never, IMPORTER_ID);
    expect(await days()).toBe(0);

    doc.users.accounts[0].settings = { ...base, watchingEpisodeDays: 5 } as never;
    await runImport.applySettingsImport(doc as never, IMPORTER_ID);
    expect(await days()).toBe(14);

    doc.users.accounts[0].settings = base as never;
    await runImport.applySettingsImport(doc as never, IMPORTER_ID);
    expect(await days()).toBe(14);
  });

  it("leaves an existing user's taste profile to be rebuilt, since their links may have changed", async () => {
    const built = new Date('2026-10-20T00:00:00.000Z');
    for (const [id, username] of [['member-1', 'member'], ['other-1', 'other']]) {
      await prisma.user.create({ data: { id, username, displayName: username, role: 'member', template: 'member' } });
      await prisma.userTasteProfile.create({ data: { userId: id, profile: {}, version: 1, builtAt: built } });
    }
    const doc = fullDocument();
    doc.users.accounts[0].anilist = { anilistUserId: 77, username: 'ani' } as never;

    const before = new Date();
    const outcome = await runImport.applySettingsImport(doc as never, IMPORTER_ID);

    const profiles = await prisma.userTasteProfile.findMany({ orderBy: { userId: 'asc' }, select: { userId: true, builtAt: true, markedAt: true } });
    expect(profiles.map(({ userId, builtAt }) => ({ userId, builtAt }))).toEqual([
      { userId: 'member-1', builtAt: new Date(0) },
      { userId: 'other-1', builtAt: built },
    ]);
    // A rebuild under way tells a mark that landed meanwhile by this time.
    expect(profiles[0].markedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(profiles[1].markedAt).toBeNull();
    // Their composed rails are dropped once the import has committed.
    expect(outcome.followUps.recommendationUserIds).toEqual(['member-1']);
  });

  it("ends every calendar feed link of an existing user when the import changes their status, and keeps them otherwise", async () => {
    await prisma.user.create({ data: { id: 'member-1', username: 'member', displayName: 'Member', role: 'member', template: 'member' } });
    await prisma.calendarFeedToken.createMany({ data: [
      { userId: 'member-1', name: 'Calendar', tokenHash: 'a'.repeat(64) },
      { userId: 'member-1', name: 'Movies', type: 'movie', tokenHash: 'b'.repeat(64) },
    ] });

    await runImport.applySettingsImport(fullDocument() as never, IMPORTER_ID);
    expect(await prisma.calendarFeedToken.count({ where: { userId: 'member-1' } })).toBe(2);

    const doc = fullDocument();
    doc.users.accounts[0].status = 'disabled';
    await runImport.applySettingsImport(doc as never, IMPORTER_ID);
    expect(await prisma.calendarFeedToken.count({ where: { userId: 'member-1' } })).toBe(0);
  });

  it("ends an existing user's calendar feed link when the import takes calendar.view away", async () => {
    await prisma.user.create({ data: { id: 'member-1', username: 'member', displayName: 'Member', role: 'member', template: 'member' } });
    await prisma.calendarFeedToken.create({ data: { userId: 'member-1', name: 'Calendar', tokenHash: 'a'.repeat(64) } });

    const doc = fullDocument();
    doc.users.accounts[0].permissions = { 'calendar.view': false } as never;
    await runImport.applySettingsImport(doc as never, IMPORTER_ID);
    expect(await prisma.calendarFeedToken.count({ where: { userId: 'member-1' } })).toBe(0);
  });

  it('imports as many user accounts as the document limits allow within the transaction timeout', async () => {
    const { validateSettingsImportComplexity } = await import('@/lib/settings-import-validation');
    const account = (i: number) => ({
      id: `bulk-user-${i}`, username: `user${i}`, displayName: `User ${i}`, role: 'member', status: 'active',
      template: 'member', permissions: {}, jellyfinUserId: null, seerrUserId: null, settings: null, anilist: null,
    });
    const doc = { users: { accounts: Array.from({ length: 4_000 }, (_, i) => account(i)) } };
    expect(validateSettingsImportComplexity(doc)).toBeNull();

    const started = performance.now();
    const outcome = await runImport.applySettingsImport(doc as never, IMPORTER_ID);
    const firstMs = performance.now() - started;
    const again = performance.now();
    await runImport.applySettingsImport(doc as never, IMPORTER_ID);
    console.log(`[benchmark] 4,000 accounts: ${Math.round(firstMs)} ms created, ${Math.round(performance.now() - again)} ms re-imported`);

    expect(outcome.applied.users).toBe(4_000);
  }, 180_000);

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
