// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ITEM, mountPlayback, type Harness } from './playback-restart-harness';
import { getQueryClient } from '@/lib/query-client';
import type { JellyfinItem } from '@/types/jellyfin';

/**
 * "Add to queue" on something that is not itself playable.
 *
 * A series, season, album or collection was appended as it stood. The player
 * reached it, asked Jellyfin to play a series id, and failed.
 */

const MOVIE = { ...ITEM, Id: 'movie-1', Name: 'A Film', Type: 'Movie' } as JellyfinItem;
const SERIES = { Id: 'series-1', Name: 'A Show', Type: 'Series', IsFolder: true } as JellyfinItem;
const SEASON_2 = { Id: 'season-2', Name: 'Season 2', Type: 'Season', IsFolder: true, SeriesId: 'series-1', IndexNumber: 2 } as JellyfinItem;
const episode = (id: string, season: number) => ({
  ...ITEM, Id: id, Name: id, SeriesId: 'series-1', SeasonId: `season-${season}`, ParentIndexNumber: season,
}) as JellyfinItem;
const EPISODES = [episode('s1e1', 1), episode('s1e2', 1), episode('s2e1', 2)];

let h: Harness;
afterEach(() => {
  h?.cleanup();
  vi.restoreAllMocks();
  getQueryClient().clear();
});

async function playing() {
  h = await mountPlayback();
  await h.act(async () => { await h.playback().playItems([ITEM]); });
  return h;
}

/** Queue `item` while the catalog answers with `held`. */
async function queue(item: JellyfinItem, held: JellyfinItem[]) {
  h.holdCatalog();
  let adding!: Promise<void>;
  await h.act(() => { adding = h.playback().addToQueue([item]); });
  await h.act(async () => { h.releaseCatalog(held); await adding; });
}

const queued = () => h.playback().queue.map((item) => item.Id);
const catalogCalls = () => vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('/api/jellyfin/catalog/'));

describe('addToQueue', () => {
  it('queues a series as its episodes', async () => {
    await playing();
    await queue(SERIES, EPISODES);
    expect(queued()).toEqual([ITEM.Id, 's1e1', 's1e2', 's2e1']);
  });

  it('queues a season as that season only', async () => {
    await playing();
    await queue(SEASON_2, EPISODES);
    expect(queued()).toEqual([ITEM.Id, 's2e1']);
  });

  it('adds nothing for a series with no episodes rather than the series itself', async () => {
    await playing();
    await queue(SERIES, []);
    expect(queued()).toEqual([ITEM.Id]);
  });

  it('queues a film as it is, without looking anything up', async () => {
    await playing();
    const before = catalogCalls().length;
    await h.act(async () => { await h.playback().addToQueue([MOVIE]); });
    expect(queued()).toEqual([ITEM.Id, MOVIE.Id]);
    expect(catalogCalls()).toHaveLength(before);
  });

  it('queues a live channel as it is', async () => {
    await playing();
    const channel = { Id: 'channel-1', Name: 'News', Type: 'TvChannel', MediaType: 'Video' } as JellyfinItem;
    await h.act(async () => { await h.playback().addToQueue([channel]); });
    expect(queued()).toEqual([ITEM.Id, 'channel-1']);
  });

  it('keeps the order things were queued in when an earlier one is still being looked up', async () => {
    await playing();
    h.holdCatalog();
    let series!: Promise<void>;
    let film!: Promise<void>;
    await h.act(() => {
      series = h.playback().addToQueue([SERIES]);
      film = h.playback().addToQueue([MOVIE]);
    });
    // The film needs no lookup, and used to land first.
    expect(queued()).toEqual([ITEM.Id]);
    await h.act(async () => { h.releaseCatalog(EPISODES); await series; await film; });
    expect(queued()).toEqual([ITEM.Id, 's1e1', 's1e2', 's2e1', MOVIE.Id]);
  });

  it('adds nothing to a player that was stopped while the lookup ran', async () => {
    await playing();
    h.holdCatalog();
    let adding!: Promise<void>;
    await h.act(() => { adding = h.playback().addToQueue([SERIES]); });
    await h.act(async () => { await h.playback().stop(); });
    await h.act(async () => { h.releaseCatalog(EPISODES); await adding; });
    expect(queued()).toEqual([]);
    expect(h.playback().item).toBeNull();
  });

  it('keeps what was queued when shuffle is turned on and off again', async () => {
    await playing();
    await queue(SERIES, EPISODES);

    await h.act(() => { h.playback().toggleShuffle(); });
    expect(queued()).toHaveLength(4);
    expect(queued()[0]).toBe(ITEM.Id);

    await h.act(() => { h.playback().toggleShuffle(); });
    expect(queued()).toEqual([ITEM.Id, 's1e1', 's1e2', 's2e1']);
  });

  it('plays a queued episode when the player reaches it', async () => {
    await playing();
    await queue(SERIES, EPISODES);
    await h.act(async () => { await h.playback().next(); });
    expect(h.requests.at(-1)?.itemId).toBe('s1e1');
    expect(h.playback().status).toBe('playing');
  });
});
