import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These routes put a caller's value into a Jellyfin request path that is signed
 * with the server's own key. The URL parser resolves dot segments, so an id
 * such as `../Items/<id>?` would turn "mark unplayed" into "delete this item"
 * and a date such as `../../Auth/Keys?` into "list every API key".
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  client: {
    markPlayed: vi.fn(),
    markUnplayed: vi.fn(),
    getPlaybackHistory: vi.fn(),
    getTypeFilterList: vi.fn(),
    startScheduledTask: vi.fn(),
    stopScheduledTask: vi.fn(),
  },
}));
vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.auth }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/service-helpers', () => ({
  getJellyfinClient: async () => mocks.client,
  getJellyfinUserContext: async () => ({ client: mocks.client, connectionFingerprint: 'server', jellyfinUserId: 'jf-user' }),
  isJellyfinUnavailable: () => false,
  JellyfinNotLinkedError: class extends Error {},
  JellyfinNotConnectedError: class extends Error {},
}));
vi.mock('@/lib/cache/jellyfin-catalog', () => ({ invalidateJellyfinCatalog: vi.fn() }));
vi.mock('@/lib/cache/jellyfin-watch-status-cache', () => ({
  invalidateWatchStatus: vi.fn(),
  seriesEpisodesSeed: vi.fn(),
  watchStatusMapSeed: vi.fn(),
}));
vi.mock('@/lib/jellyfin-watch-status-map', () => ({ fetchUserWatchStatusMap: vi.fn() }));

import { POST as watchStatus } from '@/app/api/jellyfin/watch-status/route';
import { GET as history } from '@/app/api/jellyfin/playback/history/route';
import { DELETE as stopTask, POST as startTask } from '@/app/api/jellyfin/tasks/[taskId]/route';

const ITEM_ID = '0123456789abcdef0123456789abcdef';
const USER_ID = 'fedcba9876543210fedcba9876543210';
const UNSAFE = ['../Items/0123abcd?', '..', 'abc/../../Users', 'abc?userId=other', '%2e%2e/Items/x', 'abc def', ''];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'member', role: 'member', jellyfinUserId: USER_ID } });
  mocks.client.getPlaybackHistory.mockResolvedValue([]);
  mocks.client.getTypeFilterList.mockResolvedValue(['Movie']);
});

describe('POST /api/jellyfin/watch-status', () => {
  const post = (body: unknown) => watchStatus(new NextRequest('http://helprr.test/api/jellyfin/watch-status', {
    method: 'POST',
    body: JSON.stringify(body),
  }));

  it.each(UNSAFE)('refuses the item id %j before calling Jellyfin', async (jellyfinItemId) => {
    for (const played of [true, false]) {
      expect((await post({ jellyfinItemId, played })).status).toBe(400);
    }
    expect(mocks.client.markPlayed).not.toHaveBeenCalled();
    expect(mocks.client.markUnplayed).not.toHaveBeenCalled();
  });

  it('marks a real item id', async () => {
    expect((await post({ jellyfinItemId: ITEM_ID, played: true })).status).toBe(200);
    expect(mocks.client.markPlayed).toHaveBeenCalledWith(ITEM_ID);
    expect((await post({ jellyfinItemId: ITEM_ID, played: false })).status).toBe(200);
    expect(mocks.client.markUnplayed).toHaveBeenCalledWith(ITEM_ID);
  });
});

describe('GET /api/jellyfin/playback/history', () => {
  const get = (query: Record<string, string>) =>
    history(new NextRequest(`http://helprr.test/api/jellyfin/playback/history?${new URLSearchParams(query)}`));

  it.each(['../../Auth/Keys?', '../../Users#', `../${ITEM_ID}/2026-10-01`, '2026-10-1', '2026-10-01/x'])(
    'refuses the date %j before calling Jellyfin',
    async (date) => {
      expect((await get({ date, filter: 'Movie' })).status).toBe(400);
      expect(mocks.client.getPlaybackHistory).not.toHaveBeenCalled();
      expect(mocks.client.getTypeFilterList).not.toHaveBeenCalled();
    },
  );

  it("reads a member's own history for a real date, whatever user id is asked for", async () => {
    expect((await get({ date: '2026-10-01', filter: 'Movie', userId: '../../Users' })).status).toBe(200);
    expect(mocks.client.getPlaybackHistory).toHaveBeenCalledWith(USER_ID, '2026-10-01', 'Movie');
  });

  it('refuses a user id from an admin that is not a Jellyfin id', async () => {
    mocks.auth.mockResolvedValue({ ok: true, user: { id: 'admin', role: 'admin', jellyfinUserId: null } });
    expect((await get({ date: '2026-10-01', filter: 'Movie', userId: '../../Auth/Keys?' })).status).toBe(400);
    expect(mocks.client.getPlaybackHistory).not.toHaveBeenCalled();

    expect((await get({ date: '2026-10-01', filter: 'Movie', userId: ITEM_ID })).status).toBe(200);
    expect(mocks.client.getPlaybackHistory).toHaveBeenCalledWith(ITEM_ID, '2026-10-01', 'Movie');
  });
});

describe('/api/jellyfin/tasks/[taskId]', () => {
  const run = (handler: typeof startTask, taskId: string) =>
    handler(new NextRequest('http://helprr.test/api/jellyfin/tasks/x', { method: 'POST' }), { params: Promise.resolve({ taskId }) });

  it.each(UNSAFE.filter(Boolean))('refuses the task id %j before calling Jellyfin', async (taskId) => {
    expect((await run(startTask, taskId)).status).toBe(400);
    expect((await run(stopTask, taskId)).status).toBe(400);
    expect(mocks.client.startScheduledTask).not.toHaveBeenCalled();
    expect(mocks.client.stopScheduledTask).not.toHaveBeenCalled();
  });

  it('starts and stops a real task id', async () => {
    expect((await run(startTask, ITEM_ID)).status).toBe(200);
    expect(mocks.client.startScheduledTask).toHaveBeenCalledWith(ITEM_ID);
    expect((await run(stopTask, ITEM_ID)).status).toBe(200);
    expect(mocks.client.stopScheduledTask).toHaveBeenCalledWith(ITEM_ID);
  });
});
