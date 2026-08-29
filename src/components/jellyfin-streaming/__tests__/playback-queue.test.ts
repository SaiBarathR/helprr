import { describe, expect, it } from 'vitest';
import { flattenPlayables } from '@/components/jellyfin-streaming/playback-provider';
import type { JellyfinItem } from '@/types/jellyfin';

const episode = (season: number, number: number): JellyfinItem => ({
  Id: `s${season}e${number}`,
  Name: `S${season}E${number}`,
  Type: 'Episode',
  ParentIndexNumber: season,
  IndexNumber: number,
} as JellyfinItem);

const series = (episodes: JellyfinItem[], startIndex: number) => ({ items: episodes, startIndex });

describe('flattenPlayables', () => {
  it('keeps the whole series in the queue and points the index at the episode asked for', () => {
    // The reported fault: playing episode 5 of a thirteen-episode show showed
    // "Queue · 9" and highlighted row 1, because the queue began at the episode
    // being played instead of at the start of the show.
    const episodes = Array.from({ length: 13 }, (_, i) => episode(1, i + 1));
    const { items, index } = flattenPlayables([series(episodes, 4)], 0);

    expect(items).toHaveLength(13);
    expect(index).toBe(4);
    expect(items[index].Name).toBe('S1E5');
  });

  it('spans seasons, so the index is a position in the show and not in a season', () => {
    const episodes = [
      ...Array.from({ length: 12 }, (_, i) => episode(1, i + 1)),
      ...Array.from({ length: 12 }, (_, i) => episode(2, i + 1)),
      ...Array.from({ length: 8 }, (_, i) => episode(3, i + 1)),
    ];
    const { items, index } = flattenPlayables([series(episodes, 13)], 0);

    expect(items).toHaveLength(32);
    expect(index).toBe(13);
    expect(items[index]).toMatchObject({ ParentIndexNumber: 2, IndexNumber: 2 });
  });

  it('translates a caller index across requests that each expand', () => {
    // Two series queued back to back; the caller asks for the second.
    const first = Array.from({ length: 3 }, (_, i) => episode(1, i + 1));
    const second = Array.from({ length: 5 }, (_, i) => episode(1, i + 1));
    const { items, index } = flattenPlayables([series(first, 0), series(second, 2)], 1);

    expect(items).toHaveLength(8);
    // 3 entries from the first request, then the second's own offset of 2.
    expect(index).toBe(5);
  });

  it('leaves a plain track list alone, where each entry is one item', () => {
    const tracks = Array.from({ length: 6 }, (_, i) => ({ Id: `t${i}`, Name: `Track ${i}`, Type: 'Audio' } as JellyfinItem));
    const { items, index } = flattenPlayables(tracks.map((track) => ({ items: [track], startIndex: 0 })), 3);

    expect(items).toHaveLength(6);
    expect(index).toBe(3);
    expect(items[index].Name).toBe('Track 3');
  });

  it('clamps an out-of-range request instead of leaving the player with no item', () => {
    const episodes = Array.from({ length: 4 }, (_, i) => episode(1, i + 1));
    expect(flattenPlayables([series(episodes, 0)], 9).index).toBe(0);
    expect(flattenPlayables([series(episodes, 99)], 0).index).toBe(3);
    expect(flattenPlayables([], 0)).toEqual({ items: [], index: 0 });
  });
});
