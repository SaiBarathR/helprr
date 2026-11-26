import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

import { advanceHistoryCursor, fetchNewHistoryPages } from '@/lib/polling/shared';

type Rec = { id: number; date: string };
const client = (records: Rec[]) => ({
  getHistory: async (page: number) => ({ records: page === 1 ? records : [] }),
});
const unset = { lastHistoryDate: null, lastHistoryId: null, lastHistorySeenIds: [] as number[] };

describe('history cursor at the first look', () => {
  it('a new instance with no history yet pushes its first record', async () => {
    // First poll: the app has recorded nothing.
    const first = await fetchNewHistoryPages(client([]), unset);
    expect(first.newRecords).toEqual([]);
    const cursor = advanceHistoryCursor(first.newRecords, first.allFetched, unset);
    expect(cursor.lastHistoryDate).toEqual(new Date(0));

    // Next poll: its first grab is new, not a silent starting point.
    const grab = { id: 1, date: '2026-11-26T14:10:00Z' };
    const next = await fetchNewHistoryPages(client([grab]), cursor);
    expect(next.newRecords).toEqual([grab]);
    const after = advanceHistoryCursor(next.newRecords, next.allFetched, cursor);
    expect(after.lastHistoryDate).toEqual(new Date(grab.date));
    expect(after.lastHistoryId).toBe(1);
  });

  it('an instance that already has history still starts from its newest record, sending nothing', async () => {
    const old = [{ id: 7, date: '2026-11-20T10:00:00Z' }, { id: 6, date: '2026-11-19T10:00:00Z' }];
    const first = await fetchNewHistoryPages(client(old), unset);
    expect(first.newRecords).toEqual([]);
    const cursor = advanceHistoryCursor(first.newRecords, first.allFetched, unset);
    expect(cursor.lastHistoryDate).toEqual(new Date(old[0].date));
    expect(cursor.lastHistoryId).toBe(7);

    const again = await fetchNewHistoryPages(client(old), cursor);
    expect(again.newRecords).toEqual([]);
  });
});
