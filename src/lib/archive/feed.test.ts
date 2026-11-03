import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany, lists } = vi.hoisted(() => ({ findMany: vi.fn(), lists: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { creatorSubscription: { findMany }, creatorPlaylistSubscription: { findMany: lists } } }));

import { buildFeedWhere } from './feed';

const now = new Date('2026-10-30T12:00:00Z');
const subscribed = new Date('2026-10-01T00:00:00Z');
const baselined = new Date('2026-10-01T00:00:02Z');

beforeEach(() => {
  lists.mockResolvedValue([]);
  findMany.mockResolvedValue([{ creatorId: 's1', createdAt: subscribed, creator: { baselinedAt: baselined } }]);
});

const conditions = async (query: string) =>
  ((await buildFeedWhere('TWITCH', 'u1', new URLSearchParams(query), now)).AND) as Array<Record<string, unknown>>;

describe('buildFeedWhere', () => {
  it('scopes to the user, and leaves out hidden and vanished videos', async () => {
    const and = await conditions('');
    expect(findMany.mock.calls[0][0].where).toEqual({ userId: 'u1', creator: { platform: 'TWITCH' } });
    expect(and).toContainEqual({ platform: 'TWITCH' });
    expect(and).toContainEqual({ creatorId: { in: ['s1'] } });
    expect(and).toContainEqual({ userStates: { none: { userId: 'u1', hidden: true } } });
    expect(and).toContainEqual({ availability: { not: 'UNAVAILABLE' } });
  });

  it('counts as new what was announced after the baseline, whatever the stream date', async () => {
    expect(await conditions('segment=new')).toContainEqual({ OR: [{ creatorId: 's1', notifiedAt: { gt: baselined } }] });
  });

  it('uses the later subscription for someone joining an established streamer', async () => {
    const later = new Date('2026-10-20T00:00:00Z');
    findMany.mockResolvedValue([{ creatorId: 's1', createdAt: later, creator: { baselinedAt: baselined } }]);
    expect(await conditions('segment=new')).toContainEqual({ OR: [{ creatorId: 's1', notifiedAt: { gt: later } }] });
  });

  it('filters to what is saved', async () => {
    expect(await conditions('downloaded=1')).toContainEqual({ mediaFiles: { some: {} } });
  });

  it('applies the category and date filters, and ignores an unknown date', async () => {
    const and = await conditions('category=Elden%20Ring&since=week');
    expect(and).toContainEqual({ category: 'Elden Ring' });
    expect(and).toContainEqual({ sourceCreatedAt: { gte: new Date('2026-10-23T12:00:00Z') } });
    expect((await conditions('since=forever')).some((item) => 'sourceCreatedAt' in item)).toBe(false);
  });

  describe('on YouTube', () => {
    const youtube = async (query: string) =>
      ((await buildFeedWhere('YOUTUBE', 'u1', new URLSearchParams(query), now)).AND) as Array<Record<string, unknown>>;

    it('stays on its own platform and leaves Shorts out until asked', async () => {
      const where = await youtube('');
      expect(where).toContainEqual({ platform: 'YOUTUBE' });
      expect(where).toContainEqual({ type: { not: 'SHORT' } });
    });

    it('shows only Shorts when they are asked for', async () => {
      const where = await youtube('type=SHORT');
      expect(where).toContainEqual({ type: 'SHORT' });
      expect(where).not.toContainEqual({ type: { not: 'SHORT' } });
    });

    it('ignores a Twitch type', async () => {
      expect(await youtube('type=HIGHLIGHT')).not.toContainEqual({ type: 'HIGHLIGHT' });
    });

    it('includes a followed list, whose videos may come from channels nobody follows', async () => {
      lists.mockResolvedValue([{ playlistId: 'p1', createdAt: subscribed, playlist: { baselinedAt: baselined } }]);
      expect(await youtube('')).toContainEqual({
        OR: [{ creatorId: { in: ['s1'] } }, { playlists: { some: { playlistId: { in: ['p1'] } } } }],
      });
    });

    it('counts a list video as new only once it joined after the baseline', async () => {
      lists.mockResolvedValue([{ playlistId: 'p1', createdAt: subscribed, playlist: { baselinedAt: baselined } }]);
      expect(await youtube('segment=new')).toContainEqual({
        OR: [
          { creatorId: 's1', notifiedAt: { gt: baselined } },
          { playlists: { some: { playlistId: 'p1', createdAt: { gt: baselined } } } },
        ],
      });
    });

    it('filters to one list', async () => {
      expect(await youtube('playlist=p1')).toContainEqual({ playlists: { some: { playlistId: 'p1' } } });
    });

    it('never hides anything from Twitch for being a Short', async () => {
      expect(await conditions('')).not.toContainEqual({ type: { not: 'SHORT' } });
    });
  });
});
