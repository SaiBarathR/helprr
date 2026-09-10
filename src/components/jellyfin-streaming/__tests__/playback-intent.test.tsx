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
