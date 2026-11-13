import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Activity badge sums each source's slice the poller stashed. Lidarr's
// downloads are music, so they count only for a viewer with music.view.

const mocks = vi.hoisted(() => ({
  user: {} as Record<string, unknown>,
  hGetAll: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUser: vi.fn(async () => ({ ok: true, user: mocks.user })) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/redis', () => ({ getRedisClient: async () => ({ hGetAll: mocks.hGetAll }) }));
vi.mock('@/lib/db', () => ({
  prisma: { notificationHistory: { count: async () => 0 }, creatorVideo: { count: async () => 0 } },
}));
vi.mock('@/lib/archive/feed', () => ({ buildFeedWhere: async () => ({}) }));

import { GET } from './route';

const admin = { id: 'admin', role: 'admin', template: 'admin', permissions: {} };
const member = { id: 'member', role: 'member', template: 'member', permissions: {} };
const noMusic = { id: 'no-music', role: 'member', template: 'member', permissions: { 'music.view': false } };

beforeEach(() => {
  mocks.hGetAll.mockResolvedValue({
    'activity:sonarr': JSON.stringify({ total: 3, attention: 1 }),
    'activity:radarr': JSON.stringify({ total: 2, attention: 0 }),
    'activity:lidarr': JSON.stringify({ total: 4, attention: 2 }),
  });
});

describe('GET /api/badges — Activity', () => {
  it.each([
    ['an admin', admin, { total: 9, attention: 3 }],
    ['a member with music.view', member, { total: 9, attention: 3 }],
    ['a member without music.view', noMusic, { total: 5, attention: 1 }],
  ])('counts for %s', async (_label, user, expected) => {
    mocks.user = user;
    const body = await (await GET()).json();
    expect(body.activity).toEqual(expected);
  });
});
