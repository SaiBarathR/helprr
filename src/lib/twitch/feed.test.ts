import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { twitchSubscription: { findMany } } }));

import { buildFeedWhere } from '@/lib/twitch/feed';

const now = new Date('2026-10-30T12:00:00Z');
const subscribed = new Date('2026-10-01T00:00:00Z');
const baselined = new Date('2026-10-01T00:00:02Z');

beforeEach(() => {
  findMany.mockResolvedValue([{ streamerId: 's1', createdAt: subscribed, streamer: { baselinedAt: baselined } }]);
});

const conditions = async (query: string) =>
  ((await buildFeedWhere('u1', new URLSearchParams(query), now)).AND) as Array<Record<string, unknown>>;

describe('buildFeedWhere', () => {
  it('scopes to the user, and leaves out hidden and vanished videos', async () => {
    const and = await conditions('');
    expect(findMany.mock.calls[0][0].where).toEqual({ userId: 'u1' });
    expect(and).toContainEqual({ streamerId: { in: ['s1'] } });
    expect(and).toContainEqual({ userStates: { none: { userId: 'u1', hidden: true } } });
    expect(and).toContainEqual({ availability: { not: 'UNAVAILABLE' } });
  });

  it('counts as new what was announced after the baseline, whatever the stream date', async () => {
    expect(await conditions('segment=new')).toContainEqual({ OR: [{ streamerId: 's1', notifiedAt: { gt: baselined } }] });
  });

  it('uses the later subscription for someone joining an established streamer', async () => {
    const later = new Date('2026-10-20T00:00:00Z');
    findMany.mockResolvedValue([{ streamerId: 's1', createdAt: later, streamer: { baselinedAt: baselined } }]);
    expect(await conditions('segment=new')).toContainEqual({ OR: [{ streamerId: 's1', notifiedAt: { gt: later } }] });
  });

  it('filters to what is saved', async () => {
    expect(await conditions('downloaded=1')).toContainEqual({ mediaFiles: { some: {} } });
  });

  it('applies the category and date filters, and ignores an unknown date', async () => {
    const and = await conditions('category=Elden%20Ring&since=week');
    expect(and).toContainEqual({ category: 'Elden Ring' });
    expect(and).toContainEqual({ twitchCreatedAt: { gte: new Date('2026-10-23T12:00:00Z') } });
    expect((await conditions('since=forever')).some((item) => 'twitchCreatedAt' in item)).toBe(false);
  });
});
