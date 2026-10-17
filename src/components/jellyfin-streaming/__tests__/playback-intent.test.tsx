// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { mountPlayback, ITEM, type Harness } from './playback-restart-harness';
let h: Harness | undefined;
afterEach(() => { h?.cleanup(); h = undefined; });
describe('public playback intent and clock isolation', () => {
  it('shows preparation immediately and cancels container expansion on Stop', async () => {
    h = await mountPlayback(); h.holdCatalog();
    let pending!: Promise<void>;
    await h.act(() => { pending = h!.playback().playItem({ ...ITEM, Type: 'Folder', IsFolder: true }); });
    expect(h.playback().status).toBe('loading');
    expect(h.playback().videoExpanded).toBe(true);
    expect(h.requests).toHaveLength(0);
    await h.act(() => h!.playback().stop());
    expect(h.catalogSignals[0].aborted).toBe(true);
    await pending;
    expect(h.playback().status).toBe('idle');
  });
  it('a new item supersedes a pending container without replaying it later', async () => {
    h = await mountPlayback(); h.holdCatalog();
    let pending!: Promise<void>;
    await h.act(() => { pending = h!.playback().playItem({ ...ITEM, Id: 'folder', Type: 'Folder', IsFolder: true }); });
    await h.act(() => h!.playback().playItem(ITEM));
    await pending;
    expect(h.requests.map((request) => request.itemId)).toEqual([ITEM.Id]);
    expect(h.playback().item?.Id).toBe(ITEM.Id);
  });
  it('plays a concrete episode before its show queue finishes', async () => {
    h = await mountPlayback(); h.holdCatalog();
    let pending!: Promise<void>;
    const episode = { ...ITEM, SeriesId: 'series' };
    await h.act(() => { pending = h!.playback().playItem(episode); });
    expect(h.requests.map((request) => request.itemId)).toEqual([ITEM.Id]);
    expect(h.playback().status).toBe('playing');
    await h.act(async () => { h!.releaseCatalog([{ ...episode, Id: 'earlier' }, episode]); await pending; });
    expect(h.playback().index).toBe(1);
    expect(h.playback().queue).toHaveLength(2);
  });
  it('does not commit state-only consumers on clock ticks', async () => {
    h = await mountPlayback();
    await h.act(() => h!.playback().playItem(ITEM));
    const before = h.stateCommits();
    for (let index = 1; index <= 10; index++) await h.act(() => {
      h!.element().currentTime = index;
      h!.element().dispatchEvent(new Event('timeupdate'));
    });
    expect(h.playback().positionSeconds).toBe(10);
    expect(h.stateCommits()).toBe(before);
  });
});

describe('the expanded player across tracks', () => {
  const TRACK = (id: string) => ({ ...ITEM, Id: id, Type: 'Audio', MediaType: 'Audio' }) as typeof ITEM;

  it('stays expanded when the listener expanded it and the next track starts', async () => {
    h = await mountPlayback({ audioIds: ['track-1', 'track-2'] });
    await h.act(async () => { await h!.playback().playItems([TRACK('track-1'), TRACK('track-2')], 0); });
    // Music starts in the mini player.
    expect(h.playback().videoExpanded).toBe(false);
    await h.act(() => { h!.playback().setVideoExpanded(true); });

    await h.act(async () => { await h!.playback().next(); });

    // Before the fix every track change collapsed it again.
    expect(h.playback().stream?.item.Id).toBe('track-2');
    expect(h.playback().videoExpanded).toBe(true);
  });

  it('starts a freshly picked album in the mini player even while a track plays expanded', async () => {
    h = await mountPlayback({ audioIds: ['track-1', 'track-3'] });
    await h.act(async () => { await h!.playback().playItems([TRACK('track-1')], 0); });
    await h.act(() => { h!.playback().setVideoExpanded(true); });

    // An album has no MediaType of its own, so preparing it opens the stage
    // until its tracks are known.
    h.holdCatalog();
    let picking!: Promise<void>;
    await h.act(() => {
      picking = h!.playback().playItems([{ ...ITEM, Id: 'album', Type: 'MusicAlbum', IsFolder: true, MediaType: undefined } as typeof ITEM], 0);
    });
    await h.act(async () => { h!.releaseCatalog([TRACK('track-3')]); await picking; });

    expect(h.playback().stream?.item.Id).toBe('track-3');
    expect(h.playback().videoExpanded).toBe(false);
  });

  it('still opens the stage for a video after a track', async () => {
    h = await mountPlayback({ audioIds: ['track-1'] });
    await h.act(async () => { await h!.playback().playItems([TRACK('track-1'), ITEM], 0); });
    expect(h.playback().videoExpanded).toBe(false);

    await h.act(async () => { await h!.playback().next(); });

    expect(h.playback().stream?.item.Id).toBe(ITEM.Id);
    expect(h.playback().videoExpanded).toBe(true);
  });
});
