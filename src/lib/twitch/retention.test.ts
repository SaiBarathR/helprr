import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  decideForVideo: vi.fn(),
  queryItems: vi.fn(),
  getJellyfinClientForUser: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: { twitchMediaFile: { findMany: mocks.findMany } } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/service-helpers', () => ({ getJellyfinClientForUser: mocks.getJellyfinClientForUser }));
vi.mock('@/lib/twitch/policy-store', () => ({ decideForVideo: mocks.decideForVideo }));

import { BUILT_IN_POLICY } from '@/lib/twitch/policy';
import { findRetentionCandidates, retentionReason, signRetentionPreview, verifyRetentionPreview } from '@/lib/twitch/retention';

const now = new Date('2026-10-30T12:00:00Z');
const user = { role: 'admin', jellyfinUserId: 'jf' };
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

function file(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    sizeBytes: BigInt(1000),
    createdAt: daysAgo(1),
    jellyfinItemId: `item-${id}`,
    video: {
      title: id, type: 'ARCHIVE', streamerId: 's1', durationSeconds: 60,
      twitchCreatedAt: daysAgo(1), streamer: { displayName: 'N' },
    },
    ...overrides,
  };
}

const policy = (overrides: Record<string, unknown>) => {
  mocks.decideForVideo.mockResolvedValue({ policy: { ...BUILT_IN_POLICY, ...overrides } });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryItems.mockResolvedValue({ Items: [] });
  mocks.getJellyfinClientForUser.mockResolvedValue({ queryItems: mocks.queryItems });
});

describe('findRetentionCandidates', () => {
  it('asks the database to leave out keep-forever files and anything with a job in progress', async () => {
    mocks.findMany.mockResolvedValue([]);
    await findRetentionCandidates(user, now);

    const { where } = mocks.findMany.mock.calls[0][0];
    expect(where.keepForever).toBe(false);
    expect(where.jobs.none.state.in).toEqual(expect.arrayContaining(['QUEUED', 'RUNNING']));
    expect(where.video.jobs.none.state.in).toEqual(expect.arrayContaining(['QUEUED', 'RUNNING']));
  });

  it('deletes nothing under the default policy', async () => {
    mocks.findMany.mockResolvedValue([file('a'), file('b')]);
    policy({});
    expect(await findRetentionCandidates(user, now)).toEqual([]);
  });

  it('keeps the latest N per streamer and type', async () => {
    const other = { ...file('c').video, streamerId: 's2' };
    mocks.findMany.mockResolvedValue([file('a'), file('b'), file('c', { video: other })]);
    policy({ keepLatest: 1 });

    const candidates = await findRetentionCandidates(user, now);

    expect(candidates.map((candidate) => candidate.fileId)).toEqual(['b']);
    expect(candidates[0].reason).toBe('older than the latest 1');
  });

  it('counts age from when the file was saved', async () => {
    mocks.findMany.mockResolvedValue([file('old', { createdAt: daysAgo(31) }), file('new', { createdAt: daysAgo(29) })]);
    policy({ deleteAfterDays: 30 });
    expect((await findRetentionCandidates(user, now)).map((candidate) => candidate.fileId)).toEqual(['old']);
  });

  it('deletes after watched only with a real, old enough watch date', async () => {
    mocks.findMany.mockResolvedValue([file('watched'), file('recent'), file('unwatched'), file('unlinked', { jellyfinItemId: null })]);
    mocks.queryItems.mockResolvedValue({
      Items: [
        { Id: 'item-watched', UserData: { Played: true, LastPlayedDate: daysAgo(40).toISOString() } },
        { Id: 'item-recent', UserData: { Played: true, LastPlayedDate: daysAgo(2).toISOString() } },
        { Id: 'item-unwatched', UserData: { Played: false } },
      ],
    });
    policy({ deleteAfterWatchedDays: 30 });

    expect((await findRetentionCandidates(user, now)).map((candidate) => candidate.fileId)).toEqual(['watched']);
  });

  it('deletes nothing by the watched rule when Jellyfin cannot be reached', async () => {
    mocks.findMany.mockResolvedValue([file('a')]);
    mocks.queryItems.mockRejectedValue(new Error('down'));
    policy({ deleteAfterWatchedDays: 0 });

    expect(await findRetentionCandidates(user, now)).toEqual([]);
  });

  it('deletes nothing by the watched rule without a user', async () => {
    mocks.findMany.mockResolvedValue([file('a')]);
    policy({ deleteAfterWatchedDays: 0 });

    expect(await findRetentionCandidates(null, now)).toEqual([]);
    expect(mocks.getJellyfinClientForUser).not.toHaveBeenCalled();
  });
});

describe('retention preview token', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'preview-test';
  });
  const at = 1_000_000;

  it('accepts what was shown, in any order', () => {
    const token = signRetentionPreview('u1', ['a', 'b'], at);
    expect(verifyRetentionPreview(token, 'u1', ['b', 'a'], at + 1000)).toBe(true);
  });

  it.each([
    ['another user', 'u2', ['a', 'b'], at],
    ['a file nobody was shown', 'u1', ['a', 'b', 'c'], at],
    ['an expired preview', 'u1', ['a', 'b'], at + 11 * 60_000],
  ])('refuses %s', (_name, user, ids, when) => {
    expect(verifyRetentionPreview(signRetentionPreview('u1', ['a', 'b'], at), user, ids, when)).toBe(false);
  });

  it('refuses junk', () => {
    for (const token of [undefined, '', 'x', '123.', 5]) expect(verifyRetentionPreview(token, 'u1', ['a'], at)).toBe(false);
  });
});

describe('retentionReason', () => {
  const none = { keepLatest: null, deleteAfterDays: null, deleteAfterWatchedDays: null };
  const saved = { rank: 1, savedAt: daysAgo(10) };

  it('finds nothing without a limit', () => {
    expect(retentionReason(none, saved, now)).toBeNull();
  });

  it('goes by place, then age, then when it was watched', () => {
    expect(retentionReason({ ...none, keepLatest: 2 }, { ...saved, rank: 3 }, now)).toBe('older than the latest 2');
    expect(retentionReason({ ...none, deleteAfterDays: 5 }, saved, now)).toBe('saved more than 5 days ago');
    expect(retentionReason({ ...none, deleteAfterWatchedDays: 1 }, { ...saved, watchedAt: daysAgo(2) }, now)).toBe('watched more than 1 days ago');
  });

  it('never counts a video nobody is known to have watched', () => {
    expect(retentionReason({ ...none, deleteAfterWatchedDays: 1 }, saved, now)).toBeNull();
  });
});
