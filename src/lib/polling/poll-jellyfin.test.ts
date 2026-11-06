import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActiveSessions: vi.fn(),
  getJellyfinClient: vi.fn(),
  getDefaultConnection: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  findUsers: vi.fn(),
  notifyAndLog: vi.fn(),
  noteJobFailure: vi.fn(),
}));

vi.mock('@/lib/service-helpers', () => ({ getJellyfinClient: mocks.getJellyfinClient }));
vi.mock('@/lib/arr-instances', () => ({ getDefaultConnection: mocks.getDefaultConnection }));
vi.mock('@/lib/db', () => ({
  prisma: {
    pollingState: { upsert: mocks.upsert, update: mocks.update },
    user: { findMany: mocks.findUsers },
  },
}));
vi.mock('@/lib/polling-job-report', () => ({ noteJobFailure: mocks.noteJobFailure }));
vi.mock('./shared', () => ({ notifyAndLog: mocks.notifyAndLog }));

import { pollJellyfin } from './poll-jellyfin';

const START = Date.parse('2026-11-06T20:00:00.000Z');
const MINUTE = 60_000;
let stored: { lastQueueIds: unknown; lastHistorySeenIds: unknown };

const episode = { Id: 'ep-1', Name: 'Meeting You', SeriesName: 'May I Help You?', Type: 'Episode' };
const session = (Id: string, item: Record<string, unknown> | undefined, UserId = 'jf-sai') => ({
  Id, UserId, UserName: 'sai', NowPlayingItem: item,
});

/** Runs one poll at `minutes` after START with these sessions; returns the push bodies it sent. */
async function cycle(minutes: number, sessions: unknown[]) {
  vi.setSystemTime(START + minutes * MINUTE);
  mocks.getActiveSessions.mockResolvedValue(sessions);
  mocks.notifyAndLog.mockClear();
  await pollJellyfin();
  return mocks.notifyAndLog.mock.calls.map((call) => call[0].body as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  stored = { lastQueueIds: [], lastHistorySeenIds: [] };
  mocks.getJellyfinClient.mockResolvedValue({ getActiveSessions: mocks.getActiveSessions });
  mocks.getDefaultConnection.mockResolvedValue({ id: 'jf-1' });
  mocks.upsert.mockImplementation(async () => stored);
  mocks.update.mockImplementation(async ({ data }: { data: typeof stored }) => {
    stored = data;
    return {};
  });
  mocks.findUsers.mockResolvedValue([]);
  mocks.notifyAndLog.mockResolvedValue(1);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('pollJellyfin playback pushes', () => {
  it('does not push again when the same user resumes the same item in a new session within the cooldown', async () => {
    expect(await cycle(0, [session('s1', episode)])).toEqual(['sai is watching May I Help You? - Meeting You']);
    expect(await cycle(10, [])).toEqual([]);
    expect(await cycle(20, [session('s2', episode)])).toEqual([]);
    // Two devices at once: still one push.
    expect(await cycle(30, [session('s2', episode), session('s3', episode)])).toEqual([]);
  });

  it('pushes once when two new sessions start the same item in one poll', async () => {
    expect(await cycle(0, [session('s1', episode), session('s2', episode)])).toEqual([
      'sai is watching May I Help You? - Meeting You',
    ]);
  });

  it('pushes again once the item has not been playing for the cooldown', async () => {
    await cycle(0, [session('s1', episode)]);
    await cycle(5, []);
    expect(await cycle(44, [session('s2', episode)])).toEqual([]);
    await cycle(50, []);
    expect(await cycle(44 + 46, [session('s3', episode)])).toEqual(['sai is watching May I Help You? - Meeting You']);
  });

  it('keeps a long playback quiet when it reconnects after more than the cooldown since it started', async () => {
    await cycle(0, [session('s1', episode)]);
    await cycle(40, [session('s1', episode)]);
    await cycle(80, [session('s1', episode)]);
    expect(await cycle(81, [session('s2', episode)])).toEqual([]);
  });

  it('pushes for a different item, and for another user on the same item', async () => {
    await cycle(0, [session('s1', episode)]);
    const next = { ...episode, Id: 'ep-2', Name: 'Second' };
    expect(await cycle(1, [session('s2', next)])).toEqual(['sai is watching May I Help You? - Second']);
    expect(await cycle(2, [session('s3', episode, 'jf-ana')])).toEqual(['sai is watching May I Help You? - Meeting You']);
  });

  it('says "is listening to" for music, audiobooks and radio', async () => {
    const song = { Id: 'song-1', Name: '荒野の狼', Type: 'Audio' };
    const book = { Id: 'book-1', Name: 'Dune', Type: 'AudioBook' };
    const radio = { Id: 'tv-1', Name: 'Jazz FM', Type: 'TvChannel', MediaType: 'Audio' };
    expect(await cycle(0, [session('s1', song), session('s2', book), session('s3', radio)])).toEqual([
      'sai is listening to 荒野の狼',
      'sai is listening to Dune',
      'sai is listening to Jazz FM',
    ]);
  });

  it('reads state saved before the cooldown existed and keeps the saved state bounded', async () => {
    stored = { lastQueueIds: ['s1'], lastHistorySeenIds: [] };
    expect(await cycle(0, [session('s1', episode), session('s2', { ...episode, Id: 'ep-2' })])).toHaveLength(1);
    await cycle(1, []);
    await cycle(200, [session('s9', { ...episode, Id: 'ep-9' })]);
    expect(stored).toEqual({
      lastQueueIds: ['s9'],
      lastHistorySeenIds: { 'jf-sai:ep-9': START + 200 * MINUTE },
    });
  });
});
