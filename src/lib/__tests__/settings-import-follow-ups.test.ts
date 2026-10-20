import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  alertFindMany: vi.fn(),
  pollingRestart: vi.fn(),
  setCachedCacheImagesEnabled: vi.fn(),
  setCachedAnilistTtlSettings: vi.fn(),
  purgeOlderCacheGenerations: vi.fn(),
  invalidateLayoutCache: vi.fn(),
  setAppTimeZone: vi.fn(),
  configureLogger: vi.fn(),
  configureApiLogging: vi.fn(),
  getOrCreateAppSettings: vi.fn(),
  ensureDefaultForType: vi.fn(),
  clearConnectionMemo: vi.fn(),
  restartQueueCleaner: vi.fn(),
  restartDownloadCleaner: vi.fn(),
  pruneStrikesForMissingRules: vi.fn(),
  createResolverContext: vi.fn(),
  resolveAlertOccurrencesResult: vi.fn(),
  upsertOccurrencesForAlert: vi.fn(),
  connectionFindMany: vi.fn(),
  invalidateReferenceLabels: vi.fn(),
  invalidateRecommendations: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { scheduledAlert: { findMany: mocks.alertFindMany }, serviceConnection: { findMany: mocks.connectionFindMany } },
}));
vi.mock('@/lib/cache/reference-labels', () => ({ invalidateReferenceLabels: mocks.invalidateReferenceLabels }));
vi.mock('@/lib/polling-service', () => ({ pollingService: { restart: mocks.pollingRestart } }));
vi.mock('@/lib/cache/state', () => ({
  setCachedCacheImagesEnabled: mocks.setCachedCacheImagesEnabled,
  setCachedAnilistTtlSettings: mocks.setCachedAnilistTtlSettings,
}));
vi.mock('@/lib/cache/admin', () => ({ purgeOlderCacheGenerations: mocks.purgeOlderCacheGenerations }));
vi.mock('@/lib/cache/dashboard-layout-cache', () => ({ invalidateLayoutCache: mocks.invalidateLayoutCache }));
vi.mock('@/lib/timezone', () => ({ setAppTimeZone: mocks.setAppTimeZone }));
vi.mock('@/lib/logger', () => ({ configureLogger: mocks.configureLogger }));
vi.mock('@/lib/api-logger', () => ({ configureApiLogging: mocks.configureApiLogging }));
vi.mock('@/lib/app-settings', () => ({ getOrCreateAppSettings: mocks.getOrCreateAppSettings }));
vi.mock('@/lib/arr-instances', () => ({
  ensureDefaultForType: mocks.ensureDefaultForType,
  clearConnectionMemo: mocks.clearConnectionMemo,
  isArrType: (type: string) => ['SONARR', 'RADARR', 'LIDARR'].includes(type),
}));
vi.mock('@/lib/cleanup/scheduler', () => ({
  restartQueueCleaner: mocks.restartQueueCleaner,
  restartDownloadCleaner: mocks.restartDownloadCleaner,
}));
vi.mock('@/lib/cleanup/strikes', () => ({ pruneStrikesForMissingRules: mocks.pruneStrikesForMissingRules }));
vi.mock('@/lib/scheduled-alerts/resolver', () => ({
  createResolverContext: mocks.createResolverContext,
  resolveAlertOccurrencesResult: mocks.resolveAlertOccurrencesResult,
}));
vi.mock('@/lib/scheduled-alerts/delivery', () => ({ upsertOccurrencesForAlert: mocks.upsertOccurrencesForAlert }));
vi.mock('@/lib/recommendations/engine', () => ({ invalidateRecommendations: mocks.invalidateRecommendations }));

import { runImportFollowUps, type ImportFollowUpPlan } from '@/lib/settings-import/follow-ups';

const settings = {
  cacheImagesEnabled: false,
  pollingIntervalSecs: 45,
  timeZone: 'Europe/Berlin',
  logLevel: 'info',
  logMaxFileMb: 10,
  logRetentionDays: 7,
  logEnabled: true,
  logFailedRequestBodies: false,
  logFailedResponseBodies: false,
  anilistSectionsTtlMin: 5,
  anilistBrowseTtlMin: 10,
  anilistDetailTtlMin: 1440,
  anilistAiringTtlMin: 10,
};

const fullPlan: ImportFollowUpPlan = {
  appSettings: true,
  imageCachePurge: true,
  pollingRestart: true,
  cleanupStrikePrune: true,
  cleanupSchedulers: true,
  alertIds: ['alert-1'],
  dashboardLayoutCache: true,
  serviceTypes: ['SONARR', 'RADARR', 'SONARR'],
  recommendationUserIds: ['member-1', 'member-2'],
};

// An upstream error that must never reach the operator.
const SECRET_ERROR = new Error('connect failed for http://user:hunter2@sonarr/api?apikey=abc123');

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getOrCreateAppSettings.mockResolvedValue(settings);
  mocks.purgeOlderCacheGenerations.mockResolvedValue({});
  mocks.invalidateLayoutCache.mockResolvedValue(true);
  mocks.ensureDefaultForType.mockResolvedValue(undefined);
  mocks.restartQueueCleaner.mockResolvedValue(undefined);
  mocks.restartDownloadCleaner.mockResolvedValue(undefined);
  mocks.pruneStrikesForMissingRules.mockResolvedValue(undefined);
  mocks.alertFindMany.mockResolvedValue([{ id: 'alert-1', offsetMinutes: 30 }]);
  mocks.resolveAlertOccurrencesResult.mockResolvedValue({ candidates: [], resolved: true });
  mocks.upsertOccurrencesForAlert.mockResolvedValue(undefined);
  mocks.connectionFindMany.mockImplementation(async ({ where }: { where: { type: string } }) => (
    where.type === 'SONARR' ? [{ id: 'son-1' }, { id: 'son-2' }] : [{ id: 'rad-1' }]
  ));
  mocks.invalidateReferenceLabels.mockResolvedValue(undefined);
  mocks.invalidateRecommendations.mockResolvedValue(true);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('settings import follow-ups', () => {
  it('runs every planned step from the saved settings and reports nothing when all succeed', async () => {
    await expect(runImportFollowUps(fullPlan)).resolves.toEqual([]);

    expect(mocks.getOrCreateAppSettings).toHaveBeenCalledTimes(3);
    expect(mocks.setAppTimeZone).toHaveBeenCalledWith('Europe/Berlin');
    expect(mocks.setCachedCacheImagesEnabled).toHaveBeenCalledWith(false);
    expect(mocks.purgeOlderCacheGenerations).toHaveBeenCalledOnce();
    expect(mocks.pollingRestart).toHaveBeenCalledWith(45_000);
    expect(mocks.pruneStrikesForMissingRules).toHaveBeenCalledOnce();
    expect(mocks.restartQueueCleaner).toHaveBeenCalledOnce();
    expect(mocks.restartDownloadCleaner).toHaveBeenCalledOnce();
    expect(mocks.upsertOccurrencesForAlert).toHaveBeenCalledOnce();
    expect(mocks.invalidateLayoutCache).toHaveBeenCalledOnce();
    expect(mocks.ensureDefaultForType.mock.calls).toEqual([['SONARR'], ['RADARR']]);
    expect(mocks.clearConnectionMemo).toHaveBeenCalledOnce();
    // Imported instances change the libraries and their profile and tag names.
    expect(mocks.invalidateReferenceLabels.mock.calls).toEqual([['sonarr', 'son-1'], ['sonarr', 'son-2'], ['radarr', 'rad-1']]);
    // Imported users' recommendation rails recompose with their new links.
    expect(mocks.invalidateRecommendations.mock.calls).toEqual([['member-1'], ['member-2']]);
  });

  it("stops dropping users' rails at the first sign Redis is down, so an outage logs once", async () => {
    mocks.invalidateRecommendations.mockResolvedValue(false);
    await expect(runImportFollowUps({ recommendationUserIds: ['u1', 'u2', 'u3'] })).resolves.toEqual([]);
    expect(mocks.invalidateRecommendations.mock.calls).toEqual([['u1']]);
  });

  it('stops after the batch where Redis first misses, part way through a large import', async () => {
    const users = Array.from({ length: 250 }, (_, i) => `u${i}`);
    mocks.invalidateRecommendations.mockImplementation(async (id: string) => id !== 'u50');
    await runImportFollowUps({ recommendationUserIds: users });
    // u0 alone, then the batch u1-u100 that held the miss; nothing after it.
    expect(mocks.invalidateRecommendations).toHaveBeenCalledTimes(101);
    expect(mocks.invalidateRecommendations).not.toHaveBeenCalledWith('u101');
  });

  it('runs nothing that was not planned', async () => {
    await expect(runImportFollowUps({})).resolves.toEqual([]);
    for (const fn of [mocks.getOrCreateAppSettings, mocks.pollingRestart, mocks.restartQueueCleaner, mocks.alertFindMany, mocks.invalidateLayoutCache, mocks.ensureDefaultForType, mocks.invalidateRecommendations]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['imageCachePurge', () => mocks.purgeOlderCacheGenerations.mockRejectedValue(SECRET_ERROR)],
    ['pollingRestart', () => mocks.pollingRestart.mockImplementation(() => { throw SECRET_ERROR; })],
    ['cleanupStrikePrune', () => mocks.pruneStrikesForMissingRules.mockRejectedValue(SECRET_ERROR)],
    ['cleanupSchedulers', () => mocks.restartDownloadCleaner.mockRejectedValue(SECRET_ERROR)],
    ['alertOccurrences', () => mocks.resolveAlertOccurrencesResult.mockRejectedValue(SECRET_ERROR)],
    ['dashboardLayoutCache', () => mocks.invalidateLayoutCache.mockResolvedValue(false)],
    ['defaultInstances', () => mocks.ensureDefaultForType.mockRejectedValueOnce(SECRET_ERROR)],
  ])('reports a failed %s step with fixed text and still runs the others', async (task, fail) => {
    fail();

    const warnings = await runImportFollowUps(fullPlan);

    expect(warnings).toEqual([expect.objectContaining({ task, message: expect.any(String) })]);
    expect(JSON.stringify(warnings)).not.toMatch(/hunter2|apikey|abc123|connect failed/);
    // Later steps were not skipped.
    expect(mocks.invalidateLayoutCache).toHaveBeenCalledOnce();
    expect(mocks.clearConnectionMemo).toHaveBeenCalledOnce();
  });

  it('reports all three app-settings steps when the saved settings cannot be read', async () => {
    mocks.getOrCreateAppSettings.mockRejectedValue(SECRET_ERROR);

    const warnings = await runImportFollowUps(fullPlan);

    expect(warnings.map((warning) => warning.task)).toEqual(['appSettings', 'imageCachePurge', 'pollingRestart']);
    expect(mocks.restartQueueCleaner).toHaveBeenCalledOnce();
  });

  it('restarts polling at the interval saved when it restarts, not one read before the purge', async () => {
    mocks.getOrCreateAppSettings
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({ ...settings, pollingIntervalSecs: 120 });

    await expect(runImportFollowUps({ imageCachePurge: true, pollingRestart: true })).resolves.toEqual([]);

    expect(mocks.pollingRestart).toHaveBeenCalledWith(120_000);
  });

  it('does not purge the image cache once caching is back on', async () => {
    mocks.getOrCreateAppSettings.mockResolvedValue({ ...settings, cacheImagesEnabled: true });
    await expect(runImportFollowUps({ imageCachePurge: true })).resolves.toEqual([]);
    expect(mocks.purgeOlderCacheGenerations).not.toHaveBeenCalled();
  });

  it('names the alerts still without occurrences, failed or unresolved, and resolves the rest', async () => {
    mocks.alertFindMany.mockResolvedValue([
      { id: 'ok', offsetMinutes: 10 },
      { id: 'threw', offsetMinutes: 20 },
      { id: 'unresolved', offsetMinutes: 30 },
    ]);
    mocks.resolveAlertOccurrencesResult.mockImplementation(async (alert: { id: string }) => {
      if (alert.id === 'threw') throw SECRET_ERROR;
      return { candidates: [], resolved: alert.id !== 'unresolved' };
    });

    const warnings = await runImportFollowUps({ alertIds: ['ok', 'threw', 'unresolved'] });

    expect(warnings).toEqual([expect.objectContaining({ task: 'alertOccurrences', alertIds: ['threw', 'unresolved'] })]);
    expect(mocks.createResolverContext).toHaveBeenCalledWith({ maxOffsetMinutes: 30 });
  });

  it('looks up only active release-relative alerts, and only the owner\'s when retried by a member', async () => {
    await runImportFollowUps({ alertIds: ['a', 'b'], alertOwnerId: 'member-1' });

    expect(mocks.alertFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, scheduleMode: 'release_relative', status: 'active', userId: 'member-1' },
    });
  });

  it('reports every requested alert when the alerts cannot be read', async () => {
    mocks.alertFindMany.mockRejectedValue(SECRET_ERROR);
    await expect(runImportFollowUps({ alertIds: ['a', 'b'] })).resolves.toEqual([
      expect.objectContaining({ task: 'alertOccurrences', alertIds: ['a', 'b'] }),
    ]);
  });
});
