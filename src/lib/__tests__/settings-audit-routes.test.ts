import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// Every server-wide settings save writes one security-audit row naming the
// actor, what was saved and the keys written (never values). /api/settings,
// the bandwidth schedule, database backups and the YouTube cookies have their
// own route tests; this covers the other settings saves.

const ACTOR = { id: 'u1', username: 'operator', role: 'admin', template: 'admin', permissions: {} };

const mocks = vi.hoisted(() => ({
  allowed: true,
  audit: vi.fn(),
  appSettingsUpsert: vi.fn(),
  youtubeUpdate: vi.fn(),
  archiveUpdate: vi.fn(),
  creatorFind: vi.fn(),
  policyUpsert: vi.fn(),
}));

const refused = () => ({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => null),
  requireAdmin: vi.fn(async () => (mocks.allowed ? { ok: true, user: ACTOR } : refused())),
  requireUserCapability: vi.fn(async () => (mocks.allowed ? { ok: true, user: ACTOR } : refused())),
}));
vi.mock('@/lib/security-audit', () => ({ recordSettingsUpdated: mocks.audit }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({
  prisma: {
    appSettings: { upsert: mocks.appSettingsUpsert },
    youtubeSettings: { update: mocks.youtubeUpdate },
    archiveSettings: { update: mocks.archiveUpdate },
    archiveJob: { findMany: vi.fn(async () => []) },
    creator: { findUnique: mocks.creatorFind },
    creatorPolicy: { upsert: mocks.policyUpsert },
  },
}));
vi.mock('@/lib/youtube/settings', () => ({
  getYoutubeSettings: vi.fn(async () => ({ autoDownloadEnabled: true, pollVideosSecs: 900, defaultPolicy: {}, typePolicies: {} })),
}));
vi.mock('@/lib/twitch/settings', () => ({ getTwitchSettings: vi.fn(async () => ({ browserAuthToken: null })) }));
vi.mock('@/lib/youtube/cleanup', () => ({ invalidateQueuedCleanup: vi.fn(async () => {}) }));

const diskThresholds = await import('@/app/api/settings/disk-thresholds/route');
const discoverLayout = await import('@/app/api/settings/discover-layout/route');
const youtubeSettings = await import('@/app/api/youtube/settings/route');
const twitchSettings = await import('@/app/api/twitch/settings/route');
const twitchPolicies = await import('@/app/api/twitch/policies/route');
const youtubePolicies = await import('@/app/api/youtube/policies/route');
const { DEFAULT_DISCOVER_LAYOUT } = await import('@/lib/discover-layout-config');

type Put = (request: NextRequest) => Promise<Response>;
const put = (handler: unknown, body: unknown) => (handler as Put)(
  new NextRequest('http://localhost/api/x', { method: 'PUT', body: JSON.stringify(body) }),
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed = true;
  mocks.creatorFind.mockResolvedValue({ id: 'creator-1' });
});

describe('settings saves are audited with the keys only', () => {
  it.each([
    ['Low-space alerts', diskThresholds.PUT, { thresholds: [{ diskId: '/data', minFreeGb: 50, enabled: true }] }, ['diskThresholds']],
    ['Discover layout', discoverLayout.PUT, null, ['discoverLayout']],
    ['YouTube settings', youtubeSettings.PUT, { autoDownloadEnabled: false, pollVideosSecs: 1800 }, ['autoDownloadEnabled', 'pollVideosSecs']],
    ['Twitch settings', twitchSettings.PUT, { maxConcurrentDownloads: 2, reencodeEnabled: true }, ['reencodeEnabled', 'maxConcurrentDownloads']],
    ['Twitch retention', twitchPolicies.PUT, { defaultPolicy: {}, typePolicies: {} }, ['defaultPolicy', 'typePolicies']],
    ['Twitch retention for one streamer', twitchPolicies.PUT, { streamerId: 'creator-1', policy: {} }, ['policy', 'typePolicies']],
    ['YouTube retention', youtubePolicies.PUT, { defaultPolicy: {}, typePolicies: {} }, ['defaultPolicy', 'typePolicies']],
    ['YouTube retention for one channel', youtubePolicies.PUT, { channelId: 'creator-1', policy: {} }, ['policy', 'typePolicies']],
  ])('%s', async (label, handler, body, keys) => {
    const res = await put(handler, body ?? DEFAULT_DISCOVER_LAYOUT);
    expect(res.status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), ACTOR, label, keys);
  });

  it('records nothing when a save is refused or invalid', async () => {
    expect((await put(youtubeSettings.PUT, { pollVideosSecs: 5 })).status).toBe(400);
    expect((await put(twitchSettings.PUT, { minFreeGb: 0 })).status).toBe(400);
    expect((await put(diskThresholds.PUT, { thresholds: [{ diskId: '', minFreeGb: 1, enabled: true }] })).status).toBe(400);
    mocks.creatorFind.mockResolvedValue(null);
    expect((await put(twitchPolicies.PUT, { streamerId: 'gone', policy: {} })).status).toBe(404);
    mocks.allowed = false;
    for (const handler of [diskThresholds.PUT, discoverLayout.PUT, youtubeSettings.PUT, twitchSettings.PUT, twitchPolicies.PUT, youtubePolicies.PUT]) {
      expect((await put(handler, { autoDownloadEnabled: true })).status).toBe(403);
    }
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
