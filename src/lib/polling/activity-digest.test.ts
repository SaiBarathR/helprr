import { beforeEach, describe, expect, it, vi } from 'vitest';

// The activity digest names albums and counts Lidarr's events. Someone without
// music.view gets a digest built without Lidarr's rows; the full one is marked
// so only those who may see the music library receive it.

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  users: [] as unknown[],
  sentKeys: new Set<string>(),
  sent: [] as Array<{ title: string; body: string; dedupeKey?: string; userIds?: string[]; metadata?: Record<string, unknown> }>,
  findUsers: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    notificationHistory: {
      findFirst: vi.fn(async ({ where }: { where: { dedupeKey: string } }) => (mocks.sentKeys.has(where.dedupeKey) ? { id: 'x' } : null)),
      findMany: vi.fn(async () => mocks.rows),
    },
    user: { findMany: mocks.findUsers },
  },
}));
vi.mock('./shared', () => ({
  notifyAndLog: vi.fn(async (event: (typeof mocks.sent)[number]) => { mocks.sent.push(event); return 1; }),
}));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { checkActivityDigest } from './activity-digest';

const NOW = new Date('2026-11-13T09:00:00Z');
const context = {
  startedAtMs: NOW.getTime(),
  getSettings: async () => ({ activityDigestMode: 'daily', activityDigestHour: 8, activityDigestDayOfWeek: 1, timeZone: 'UTC' }),
} as never;
const row = (eventType: string, body: string, source: string, extra: Record<string, unknown> = {}) => ({
  eventType, body, metadata: { source, ...extra }, createdAt: new Date('2026-11-12T12:00:00Z'),
});
const SONARR_ROWS = [row('imported', 'Severance S02E01', 'sonarr'), row('grabbed', 'Film.2026', 'radarr')];
const LIDARR_ROWS = [
  row('imported', 'Mock Artist - Secret Album', 'lidarr', { groupCount: 3 }),
  row('upcomingPremiere', 'Mock Artist - Next Album', 'lidarr'),
];

beforeEach(() => {
  mocks.sent = [];
  mocks.sentKeys = new Set();
  mocks.findUsers.mockReset().mockImplementation(async () => mocks.users);
  mocks.users = [
    { id: 'admin', role: 'admin', template: 'admin', permissions: {} },
    { id: 'member', role: 'member', template: 'member', permissions: {} },
    { id: 'no-music', role: 'member', template: 'member', permissions: { 'music.view': false } },
  ];
});

describe('activity digest and the music library', () => {
  it('sends one unmarked digest to everyone when nothing came from Lidarr', async () => {
    mocks.rows = SONARR_ROWS;
    await checkActivityDigest(context);
    expect(mocks.sent).toHaveLength(1);
    expect(mocks.sent[0].userIds).toBeUndefined();
    expect(mocks.sent[0].metadata).not.toHaveProperty('includesLidarr');
    expect(mocks.findUsers).not.toHaveBeenCalled();
  });

  it('marks the full digest for music.view, and sends the others one without Lidarr', async () => {
    mocks.rows = [...LIDARR_ROWS, ...SONARR_ROWS];
    await checkActivityDigest(context);

    const [withoutMusic, full] = mocks.sent;
    expect(mocks.sent).toHaveLength(2);

    expect(full.dedupeKey).toBe('activity-digest-daily-2026-11-13');
    expect(full.userIds).toBeUndefined();
    expect(full.metadata).toMatchObject({ includesLidarr: true, sourceCounts: { lidarr: 4, sonarr: 1, radarr: 1 } });
    expect(full.body).toContain('Mock Artist - Secret Album');
    expect(full.body).toContain('4 Lidarr');

    expect(withoutMusic.dedupeKey).toBe('activity-digest-daily-2026-11-13-without-music');
    expect(withoutMusic.userIds).toEqual(['no-music']);
    expect(withoutMusic.metadata).not.toHaveProperty('includesLidarr');
    expect(withoutMusic.metadata).toMatchObject({ eventCount: 2, sourceCounts: { sonarr: 1, radarr: 1 } });
    expect(withoutMusic.body).not.toMatch(/Mock Artist|Lidarr|lidarr/);
    expect(withoutMusic.body).toBe('1 import · 1 download started. Severance S02E01. via 1 Sonarr, 1 Radarr');
  });

  it('sends no second digest when everyone may see music, or when only Lidarr happened', async () => {
    mocks.rows = [...LIDARR_ROWS, ...SONARR_ROWS];
    mocks.users = mocks.users.slice(0, 2);
    await checkActivityDigest(context);
    expect(mocks.sent.map((e) => e.dedupeKey)).toEqual(['activity-digest-daily-2026-11-13']);

    mocks.sent = [];
    mocks.users = [{ id: 'no-music', role: 'member', template: 'member', permissions: { 'music.view': false } }];
    mocks.rows = LIDARR_ROWS;
    await checkActivityDigest(context);
    expect(mocks.sent.map((e) => e.dedupeKey)).toEqual(['activity-digest-daily-2026-11-13']);
  });

  it('sends the digest without Lidarr once, even when the full one is retried', async () => {
    mocks.rows = [...LIDARR_ROWS, ...SONARR_ROWS];
    mocks.sentKeys.add('activity-digest-daily-2026-11-13-without-music');
    await checkActivityDigest(context);
    expect(mocks.sent.map((e) => e.dedupeKey)).toEqual(['activity-digest-daily-2026-11-13']);
  });
});
