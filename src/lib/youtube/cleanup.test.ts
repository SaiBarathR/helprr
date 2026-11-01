import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  claim: vi.fn(),
  connection: vi.fn(),
  files: vi.fn(),
  setClears: vi.fn(),
  jobCount: vi.fn(),
  enqueue: vi.fn(),
  decide: vi.fn(),
  notify: vi.fn(),
  getUser: vi.fn(),
  queryItems: vi.fn(),
  sessions: vi.fn(),
  client: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    youtubeSettings: { updateMany: mocks.claim },
    serviceConnection: { findUnique: mocks.connection },
    archiveMediaFile: { findMany: mocks.files, updateMany: mocks.setClears },
    archiveJob: { count: mocks.jobCount },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/polling/shared', () => ({ errorMessage: String, notifyAndLog: mocks.notify }));
vi.mock('@/lib/service-connection-secrets', () => ({ getConnectionHeaders: () => undefined }));
vi.mock('@/lib/youtube/settings', () => ({ getYoutubeSettings: mocks.settings }));
vi.mock('@/lib/youtube/policy', () => ({ POLICY_VIDEO: { id: true }, decideForYoutubeVideo: mocks.decide }));
vi.mock('@/lib/archive/retention', async (original) => ({
  ...await original<typeof import('@/lib/archive/retention')>(),
  enqueueFileDelete: mocks.enqueue,
}));
vi.mock('@/lib/service-helpers', () => ({ getJellyfinClientForUser: vi.fn() }));
vi.mock('@/lib/jellyfin-client', () => ({
  JellyfinClient: class {
    constructor(...args: unknown[]) {
      mocks.client(...args);
    }
    getUser = mocks.getUser;
    queryItems = mocks.queryItems;
    getActiveSessions = mocks.sessions;
  },
}));

import { sweepWatchedVideos } from './cleanup';

const NOW = new Date('2026-11-10T12:00:00Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const settings = {
  autoCleanupEnabled: true, cleanupJellyfinUserId: 'viewer', cleanupConnectionId: 'jf', cleanupGeneration: 7,
};
const file = (id: string) => ({ id, createdAt: daysAgo(30), clearsAt: null, jellyfinItemId: `item-${id}`, video: { title: id } });
const watched = (ids: string[], days = 10) => ({
  Items: ids.map((id) => ({ Id: `item-${id}`, UserData: { Played: true, LastPlayedDate: daysAgo(days).toISOString() } })),
});
const statusSaved = () => mocks.claim.mock.calls.map(([args]) => args.data.cleanupStatus).filter((value) => value !== undefined).at(-1);

describe('automatic cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.mockResolvedValue(settings);
    mocks.claim.mockResolvedValue({ count: 1 });
    mocks.connection.mockResolvedValue({ id: 'jf', type: 'JELLYFIN', url: 'http://jf', apiKey: 'token' });
    mocks.getUser.mockResolvedValue({ Id: 'viewer' });
    mocks.files.mockResolvedValue([file('a')]);
    mocks.queryItems.mockResolvedValue(watched(['a']));
    mocks.sessions.mockResolvedValue([]);
    mocks.decide.mockResolvedValue({ policy: { deleteAfterWatchedDays: 3, keepLatest: 1, deleteAfterDays: 1 } });
    mocks.jobCount.mockResolvedValue(0);
    mocks.enqueue.mockResolvedValue(true);
  });

  it('does nothing at all until it is turned on', async () => {
    mocks.settings.mockResolvedValue({ ...settings, autoCleanupEnabled: false });
    await sweepWatchedVideos(NOW);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('skips when another sweep has just run', async () => {
    mocks.claim.mockResolvedValueOnce({ count: 0 });
    await sweepWatchedVideos(NOW);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('clears a video watched long enough ago, as the system, tied to these rules', async () => {
    await sweepWatchedVideos(NOW);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledWith('a', { id: null, username: 'Automatic cleanup' }, 'YOUTUBE', {
      retention: true, automatic: true, generation: 7, reason: 'watched more than 3 days ago',
    });
  });

  it('reads as the stored viewer, on the stored connection, and nobody else', async () => {
    await sweepWatchedVideos(NOW);
    expect(mocks.connection).toHaveBeenCalledWith({ where: { id: 'jf' } });
    expect(mocks.client).toHaveBeenCalledWith('http://jf', 'token', 'viewer', undefined);
  });

  it('only looks at YouTube files that nothing is using or keeping', async () => {
    await sweepWatchedVideos(NOW);
    expect(mocks.files.mock.calls[0][0].where).toMatchObject({
      platform: 'YOUTUBE', keepForever: false, jobs: { none: {} }, video: { jobs: { none: {} } },
    });
  });

  it('never clears an unwatched video, whatever the other rules say', async () => {
    mocks.queryItems.mockResolvedValue({ Items: [{ Id: 'item-a', UserData: { Played: false } }] });
    await sweepWatchedVideos(NOW);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('leaves a video watched too recently, and shows when it will clear', async () => {
    mocks.queryItems.mockResolvedValue(watched(['a'], 1));
    await sweepWatchedVideos(NOW);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.setClears).toHaveBeenCalledWith({ where: { id: 'a' }, data: { clearsAt: new Date(daysAgo(1).getTime() + 3 * DAY) } });
  });

  it('leaves everything when the rule is off for that video', async () => {
    mocks.decide.mockResolvedValue({ policy: { deleteAfterWatchedDays: null } });
    await sweepWatchedVideos(NOW);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('skips a video someone is playing right now', async () => {
    mocks.sessions.mockResolvedValue([{ NowPlayingItem: { Id: 'item-a' } }]);
    await sweepWatchedVideos(NOW);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ['Jellyfin cannot be read', () => mocks.queryItems.mockRejectedValue(new Error('down')), 'Could not read'],
    ['sessions cannot be read', () => mocks.sessions.mockRejectedValue(new Error('down')), 'Could not read'],
    ['the viewer has gone', () => mocks.getUser.mockRejectedValue(new Error('404')), 'Could not confirm the viewer'],
    ['the connection has changed', () => mocks.connection.mockResolvedValue(null), 'connection changed'],
    ['it is not Jellyfin any more', () => mocks.connection.mockResolvedValue({ type: 'SONARR' }), 'connection changed'],
    ['no viewer was chosen', () => mocks.settings.mockResolvedValue({ ...settings, cleanupJellyfinUserId: null }), 'Choose whose'],
  ])('stops when %s, clearing nothing and saying why', async (_label, arrange, message) => {
    arrange();
    await sweepWatchedVideos(NOW);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(statusSaved()).toContain(message);
  });

  it('clears at most 20 in a sweep, then pauses and asks a person to look', async () => {
    const ids = Array.from({ length: 25 }, (_, index) => `f${index}`);
    mocks.files.mockResolvedValue(ids.map(file));
    mocks.queryItems.mockResolvedValue(watched(ids));

    await sweepWatchedVideos(NOW);

    expect(mocks.enqueue).toHaveBeenCalledTimes(20);
    expect(mocks.claim.mock.calls.at(-1)?.[0].data).toMatchObject({ autoCleanupEnabled: false });
    expect(mocks.notify.mock.calls[0][0]).toMatchObject({ eventType: 'youtubeCleanupPaused' });
  });

  it('counts the whole day across sweeps', async () => {
    const ids = Array.from({ length: 10 }, (_, index) => `f${index}`);
    mocks.files.mockResolvedValue(ids.map(file));
    mocks.queryItems.mockResolvedValue(watched(ids));
    mocks.jobCount.mockResolvedValue(45);

    await sweepWatchedVideos(NOW);

    expect(mocks.enqueue).toHaveBeenCalledTimes(5);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it('clears the status once a sweep goes well', async () => {
    await sweepWatchedVideos(NOW);
    expect(statusSaved()).toBeNull();
  });
});
