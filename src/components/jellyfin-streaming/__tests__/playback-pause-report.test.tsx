// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ITEM, mountPlayback, type Harness } from './playback-restart-harness';

/**
 * A pause or resume is reported to Jellyfin as it happens, as jellyfin-web
 * does, rather than on the next ten-second progress tick: until then
 * Jellyfin's dashboard showed the title playing, its position still rising.
 */

let harness: Harness | null = null;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

async function playing(): Promise<Harness> {
  const h = await mountPlayback();
  harness = h;
  await h.act(async () => { await h.playback().playItem(ITEM); });
  expect(h.media.paused()).toBe(false);
  return h;
}

const progress = (h: Harness) => h.reports.filter((report) => report.event === 'progress').map((report) => report.isPaused);

describe('pause and resume reports', () => {
  it('reports a pause and a resume at once, one report each', async () => {
    const h = await playing();
    expect(progress(h)).toEqual([]);

    await h.act(() => { h.playback().togglePause(); });
    expect(progress(h)).toEqual([true]);

    await h.act(() => { h.playback().togglePause(); });
    expect(progress(h)).toEqual([true, false]);
  });

  it('reports a pause from outside the player (lock screen, headphones) too', async () => {
    const h = await playing();
    await h.act(() => { h.element().pause(); });
    expect(progress(h)).toEqual([true]);
  });

  it('sends nothing extra for a track change while paused: its start report says paused', async () => {
    const h = await playing();
    await h.act(() => { h.playback().togglePause(); });
    await h.act(async () => { await h.playback().setAudioStream(2); });

    expect(progress(h)).toEqual([true]);
    expect(h.reports.at(-1)).toMatchObject({ event: 'playing', isPaused: true });
  });

  it('sends no progress after Stop, nor for the pause an ending fires', async () => {
    const h = await playing();
    await h.act(async () => { await h.playback().stop(); });
    expect(h.reports.map((report) => report.event)).toEqual(['playing', 'stopped']);
    h.cleanup();

    const h2 = await playing();
    const el = h2.element();
    Object.defineProperty(el, 'ended', { configurable: true, get: () => true });
    await h2.act(async () => {
      el.pause();
      el.dispatchEvent(new Event('ended'));
    });
    expect(progress(h2)).toEqual([]);
  });
});
