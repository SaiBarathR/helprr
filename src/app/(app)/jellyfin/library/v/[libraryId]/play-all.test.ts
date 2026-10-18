import { describe, expect, it, vi } from 'vitest';
import { PLAY_ALL_MAX, collectForPlayAll, playAllNotice } from './play-all';

// A catalog of `size` titles that pages like the route: at most `limit` from `startIndex`.
function catalog(size: number) {
  return vi.fn(async (limit: number, startIndex: number) => ({
    items: Array.from({ length: Math.max(0, Math.min(limit, size - startIndex)) }, (_, i) => startIndex + i),
    total: size,
  }));
}

describe('collectForPlayAll', () => {
  it('queues the whole set when it fits', async () => {
    const fetchPage = catalog(492);
    const { items, total } = await collectForPlayAll(fetchPage);
    expect(items).toHaveLength(492);
    expect(total).toBe(492);
  });

  it('stops at exactly the ceiling, asking only for what it still needs', async () => {
    const fetchPage = catalog(1200);
    const { items, total } = await collectForPlayAll(fetchPage);

    expect(items).toHaveLength(PLAY_ALL_MAX);
    expect(items.at(-1)).toBe(PLAY_ALL_MAX - 1);
    expect(total).toBe(1200);
    expect(fetchPage.mock.calls).toEqual([[200, 0], [200, 200], [100, 400]]);
  });

  it('stops when a page comes back empty', async () => {
    const fetchPage = vi.fn(async () => ({ items: [] as number[], total: 50 }));
    expect(await collectForPlayAll(fetchPage)).toEqual({ items: [], total: 50 });
    expect(fetchPage).toHaveBeenCalledOnce();
  });
});

describe('playAllNotice', () => {
  it('says how many of the set were queued when the ceiling cut it', () => {
    expect(playAllNotice(PLAY_ALL_MAX, 507, false)).toBe('Queued 500 of 507 titles');
    expect(playAllNotice(PLAY_ALL_MAX, 507, true)).toBe('Shuffled 500 of 507 titles');
  });

  it('stays quiet when the whole set was queued or nothing was', () => {
    expect(playAllNotice(492, 492, false)).toBeNull();
    expect(playAllNotice(0, 507, false)).toBeNull();
  });

  it('also speaks up when the set came back shorter than its total', () => {
    expect(playAllNotice(300, 492, false)).toBe('Queued 300 of 492 titles');
  });
});
