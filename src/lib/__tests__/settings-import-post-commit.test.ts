import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  transaction: vi.fn(),
  appSettingsFindUnique: vi.fn(),
  appSettingsUpsert: vi.fn(),
  getOrCreateAppSettings: vi.fn(),
  pollingRestart: vi.fn(),
  purgeOlderCacheGenerations: vi.fn(),
  invalidateLayoutCache: vi.fn(),
  restartQueueCleaner: vi.fn(),
  restartDownloadCleaner: vi.fn(),
  pruneStrikesForMissingRules: vi.fn(),
  alertFindMany: vi.fn(),
  resolveAlertOccurrencesResult: vi.fn(),
  ensureDefaultForType: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/db', () => ({ prisma: { $transaction: mocks.transaction, scheduledAlert: { findMany: mocks.alertFindMany } } }));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
  configureApiLogging: vi.fn(),
}));
vi.mock('@/lib/polling-service', () => ({ pollingService: { restart: mocks.pollingRestart } }));
vi.mock('@/lib/cache/state', () => ({ setCachedCacheImagesEnabled: vi.fn(), setCachedAnilistTtlSettings: vi.fn() }));
vi.mock('@/lib/cache/admin', () => ({ purgeOlderCacheGenerations: mocks.purgeOlderCacheGenerations }));
vi.mock('@/lib/cache/dashboard-layout-cache', () => ({ invalidateLayoutCache: mocks.invalidateLayoutCache }));
vi.mock('@/lib/logger', () => ({ configureLogger: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/app-settings', () => ({ getOrCreateAppSettings: mocks.getOrCreateAppSettings }));
vi.mock('@/lib/cleanup/scheduler', () => ({
  restartDownloadCleaner: mocks.restartDownloadCleaner,
  restartQueueCleaner: mocks.restartQueueCleaner,
}));
vi.mock('@/lib/cleanup/strikes', () => ({ pruneStrikesForMissingRules: mocks.pruneStrikesForMissingRules }));
vi.mock('@/lib/scheduled-alerts/resolver', () => ({
  createResolverContext: vi.fn(),
  resolveAlertOccurrencesResult: mocks.resolveAlertOccurrencesResult,
}));
vi.mock('@/lib/scheduled-alerts/delivery', () => ({ upsertOccurrencesForAlert: vi.fn() }));
vi.mock('@/lib/arr-instances', () => ({
  isArrType: (type: string) => ['SONARR', 'RADARR', 'LIDARR'].includes(type),
  ensureDefaultForType: mocks.ensureDefaultForType,
  clearConnectionMemo: vi.fn(),
}));
vi.mock('@/lib/timezone', () => ({ setAppTimeZone: vi.fn(), isValidTimeZone: () => true, getEnvTimeZone: () => 'UTC' }));

import { POST as importSettings } from '@/app/api/settings/import/route';
import { POST as retryFollowUps } from '@/app/api/settings/import/follow-up/route';
import * as followUps from '@/lib/settings-import/follow-ups';

const admin = { id: 'admin-id', username: 'admin', role: 'admin', status: 'active', permissions: {} };
const member = { id: 'member-id', username: 'member', role: 'user', status: 'active', permissions: {} };
const savedSettings = {
  id: 'singleton', cacheImagesEnabled: true, pollingIntervalSecs: 60, timeZone: 'UTC', logLevel: 'info',
  logMaxFileMb: 10, logRetentionDays: 7, logEnabled: true, logFailedRequestBodies: false, logFailedResponseBodies: false,
  anilistSectionsTtlMin: 5, anilistBrowseTtlMin: 10, anilistDetailTtlMin: 1440, anilistAiringTtlMin: 10,
};

function post(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: admin, session: {} });
  mocks.appSettingsFindUnique.mockResolvedValue(savedSettings);
  mocks.appSettingsUpsert.mockResolvedValue({ ...savedSettings, pollingIntervalSecs: 120 });
  mocks.getOrCreateAppSettings.mockResolvedValue({ ...savedSettings, pollingIntervalSecs: 120 });
  mocks.invalidateLayoutCache.mockResolvedValue(true);
  mocks.alertFindMany.mockResolvedValue([{ id: 'scheduledAlert-id', offsetMinutes: 0 }]);
  mocks.resolveAlertOccurrencesResult.mockResolvedValue({ candidates: [], resolved: true });
  const tx = { appSettings: { findUnique: mocks.appSettingsFindUnique, upsert: mocks.appSettingsUpsert } };
  mocks.transaction.mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));
});

describe('settings import after commit', () => {
  it('reports the steps that did not take effect without failing the saved import', async () => {
    mocks.pollingRestart.mockImplementation(() => {
      throw new Error('polling failed: http://user:hunter2@host');
    });

    const response = await importSettings(post('/api/settings/import', { appSettings: { pollingIntervalSecs: 120 } }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(mocks.appSettingsUpsert).toHaveBeenCalledOnce();
    expect(body.applied.appSettings).toBe(true);
    expect(body.warnings).toEqual([{ task: 'pollingRestart', message: expect.any(String) }]);
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(body).not.toHaveProperty('pollingRestarted');
  });

  it('answers 200 even when the saved settings cannot be read back', async () => {
    mocks.getOrCreateAppSettings.mockRejectedValue(new Error('database gone'));

    const response = await importSettings(post('/api/settings/import', { appSettings: { pollingIntervalSecs: 120 } }));

    expect(response.status).toBe(200);
    expect((await response.json()).warnings.map((warning: { task: string }) => warning.task))
      .toEqual(['appSettings', 'pollingRestart']);
  });

  it('returns no warnings when everything took effect', async () => {
    const response = await importSettings(post('/api/settings/import', { appSettings: { pollingIntervalSecs: 120 } }));

    expect((await response.json()).warnings).toEqual([]);
    expect(mocks.pollingRestart).toHaveBeenCalledWith(120_000);
  });
});

// Every model method answers like an empty database, so each section's real
// import code runs and commits through it.
function emptyDatabaseTx(writes: string[]) {
  return new Proxy({}, {
    get: (_tx, model) => {
      if (model === '$executeRaw') return async () => 0;
      return new Proxy({}, {
        get: (_model, method) => async (args?: { data?: object | object[]; create?: object }) => {
          if (method === 'findMany') return [];
          if (method === 'findUnique' || method === 'findFirst') return null;
          if (method === 'count') return 0;
          writes.push(`${String(model)}.${String(method)}`);
          if (method === 'deleteMany' || method === 'updateMany' || method === 'createMany') return { count: 0 };
          if (method === 'createManyAndReturn') {
            return (args?.data as object[]).map((row, i) => ({ id: `${String(model)}-id-${i}`, ...row }));
          }
          return { id: `${String(model)}-id`, ...(method === 'upsert' ? args?.create : args?.data) };
        },
      });
    },
  });
}

const SECRET = new Error('failed at http://user:hunter2@host/?apikey=abc123');

describe('each step that fails after the import commits', () => {
  it.each([
    ['cleanupStrikePrune', { cleanup: { queueConfig: { enabled: false }, downloadConfig: { enabled: false } } },
      () => mocks.pruneStrikesForMissingRules.mockRejectedValue(SECRET), 'queueCleanerConfig.upsert'],
    ['cleanupSchedulers', { cleanup: { queueConfig: { enabled: false }, downloadConfig: { enabled: false } } },
      () => mocks.restartQueueCleaner.mockRejectedValue(SECRET), 'downloadCleanerConfig.upsert'],
    ['alertOccurrences', { scheduledAlerts: { alerts: [{ source: 'TMDB', mediaType: 'movie', externalId: '603', title: 'The Matrix', scheduleMode: 'release_relative', scope: 'movie', releaseTypes: ['digital'] }] } },
      () => mocks.resolveAlertOccurrencesResult.mockRejectedValue(SECRET), 'scheduledAlert.createManyAndReturn'],
    ['dashboardLayoutCache', { dashboardLayouts: { layouts: [{ slug: 'desktop', name: 'Desktop', widgets: [] }] } },
      () => mocks.invalidateLayoutCache.mockResolvedValue(false), 'dashboardLayout.create'],
    ['defaultInstances', { serviceConnections: [{ type: 'SONARR', url: 'http://sonarr:8989', apiKey: 'imported-key', label: 'Sonarr' }] },
      () => mocks.ensureDefaultForType.mockRejectedValue(SECRET), 'serviceConnection.create'],
    ['imageCachePurge', { appSettings: { cacheImagesEnabled: false } },
      () => {
        mocks.appSettingsFindUnique.mockResolvedValue({ ...savedSettings, cacheImagesEnabled: true });
        mocks.appSettingsUpsert.mockResolvedValue({ ...savedSettings, cacheImagesEnabled: false });
        mocks.getOrCreateAppSettings.mockResolvedValue({ ...savedSettings, cacheImagesEnabled: false });
        mocks.purgeOlderCacheGenerations.mockRejectedValue(SECRET);
      }, 'appSettings.upsert'],
  ])('%s: the data stays committed and the response carries only a fixed warning', async (task, section, fail, write) => {
    const writes: string[] = [];
    if (task !== 'imageCachePurge') {
      const tx = emptyDatabaseTx(writes);
      mocks.transaction.mockImplementation(async (callback: (value: unknown) => unknown) => callback(tx));
    }
    fail();

    const response = await importSettings(post('/api/settings/import', section));

    expect(response.status).toBe(200);
    const body = await response.json();
    if (task === 'imageCachePurge') expect(mocks.appSettingsUpsert).toHaveBeenCalledOnce();
    else expect(writes).toContain(write);
    expect(body.warnings).toEqual([expect.objectContaining({ task, message: expect.any(String) })]);
    expect(JSON.stringify(body)).not.toMatch(/hunter2|apikey|abc123|imported-key/);
  });
});

describe('retrying import follow-ups', () => {
  beforeEach(() => {
    vi.spyOn(followUps, 'runImportFollowUps').mockResolvedValue([]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires the backup capability', async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    const response = await retryFollowUps(post('/api/settings/import/follow-up', { tasks: ['alertOccurrences'] }));
    expect(response.status).toBe(403);
    expect(followUps.runImportFollowUps).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ tasks: [] }],
    [{ tasks: ['dropDatabase'] }],
    [{ tasks: 'appSettings' }],
    [{ tasks: ['alertOccurrences'], alertIds: 'a' }],
    [{ tasks: ['alertOccurrences'], alertIds: [42] }],
    [{ tasks: ['alertOccurrences'], alertIds: Array.from({ length: 20_001 }, (_, i) => `a${i}`) }],
  ])('rejects a malformed request %#', async (body) => {
    const response = await retryFollowUps(post('/api/settings/import/follow-up', body));
    expect(response.status).toBe(400);
    expect(followUps.runImportFollowUps).not.toHaveBeenCalled();
  });

  it('lets a member retry only their own alerts', async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: true, user: member, session: {} });

    const forbidden = await retryFollowUps(post('/api/settings/import/follow-up', { tasks: ['alertOccurrences', 'pollingRestart'] }));
    expect(forbidden.status).toBe(403);
    expect(followUps.runImportFollowUps).not.toHaveBeenCalled();

    const allowed = await retryFollowUps(post('/api/settings/import/follow-up', { tasks: ['alertOccurrences'], alertIds: ['a1'] }));
    expect(allowed.status).toBe(200);
    expect(followUps.runImportFollowUps).toHaveBeenCalledWith(expect.objectContaining({
      alertIds: ['a1'], alertOwnerId: 'member-id', appSettings: false, cleanupSchedulers: false, serviceTypes: [],
    }));
  });

  it('runs exactly the requested steps for an admin and returns what is still not done', async () => {
    vi.mocked(followUps.runImportFollowUps).mockResolvedValue([{ task: 'cleanupSchedulers', message: 'm' }]);

    const response = await retryFollowUps(post('/api/settings/import/follow-up', { tasks: ['cleanupSchedulers', 'defaultInstances'] }));

    expect(await response.json()).toEqual({ warnings: [{ task: 'cleanupSchedulers', message: 'm' }] });
    expect(followUps.runImportFollowUps).toHaveBeenCalledWith({
      appSettings: false,
      imageCachePurge: false,
      pollingRestart: false,
      cleanupStrikePrune: false,
      cleanupSchedulers: true,
      alertIds: [],
      alertOwnerId: undefined,
      dashboardLayoutCache: false,
      serviceTypes: followUps.ALL_SERVICE_TYPES,
    });
  });
});
