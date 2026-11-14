// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getQueryClient } from '@/lib/query-client';
import { ITEM, mountPlayback, type Harness } from './playback-restart-harness';

/**
 * A track change while paused on an iPhone reloads the stream through Safari's
 * own HLS, which showed black, and a 0:00 readout, for the 8–15 s a 4K
 * transcode takes. jsdom has no MediaSource, so the harness's HLS stream takes
 * that same `el.src` path.
 */

let h: Harness;
const drawImage = vi.fn();
const proto = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
beforeEach(() => {
  Object.defineProperty(proto, 'videoWidth', { configurable: true, get: () => 1920 });
  Object.defineProperty(proto, 'videoHeight', { configurable: true, get: () => 1080 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  h?.cleanup();
  vi.restoreAllMocks();
  delete proto.videoWidth;
  delete proto.videoHeight;
  getQueryClient().clear();
});

const RESUME = { ...ITEM, UserData: { PlaybackPositionTicks: 600 * 10_000_000 } } as typeof ITEM;
const held = () => h.element().nextElementSibling?.tagName === 'CANVAS';

async function pausedAt600() {
  h = await mountPlayback({ hls: true });
  await h.act(async () => { await h.playback().playItem(RESUME); });
  const el = h.element();
  el.currentTime = 600;
  el.dispatchEvent(new Event('timeupdate'));
  await h.act(() => { h.playback().togglePause(); });
  expect(h.playback().status).toBe('paused');
  expect(held()).toBe(false);
}

it('keeps the last frame and the real position over a paused track change, until the new stream has a frame', async () => {
  await pausedAt600();
  const el = h.element();

  await h.act(async () => { await h.playback().setAudioStream(2); });

  expect(h.requests.at(-1)).toMatchObject({ audioStreamIndex: 2, startTimeTicks: 600 * 10_000_000 });
  expect(h.playback().status).toBe('paused');
  expect(held()).toBe(true);
  expect(drawImage).toHaveBeenCalledWith(el, 0, 0, 1920, 1080);

  // The new source reads zero until it has seeked itself into place.
  await h.act(() => {
    el.currentTime = 0;
    el.dispatchEvent(new Event('timeupdate'));
  });
  expect(h.playback().positionSeconds).toBe(600);

  await h.act(() => { el.dispatchEvent(new Event('loadeddata')); });
  expect(held()).toBe(false);
  await h.act(() => { el.dispatchEvent(new Event('loadedmetadata')); });
  expect(el.currentTime).toBe(600);
});

it('keeps one frame across two changes in a row, and drops it for another title', async () => {
  await pausedAt600();
  await h.act(async () => { await h.playback().setAudioStream(2); });
  await h.act(async () => { await h.playback().setAudioStream(1); });
  expect(h.element().parentElement?.querySelectorAll('canvas')).toHaveLength(1);

  await h.act(async () => { await h.playback().playItem({ ...ITEM, Id: 'item-2' }); });
  expect(held()).toBe(false);
});

it('drops the frame on Stop', async () => {
  await pausedAt600();
  await h.act(async () => { await h.playback().setAudioStream(2); });
  expect(held()).toBe(true);
  await h.act(async () => { await h.playback().stop(); });
  expect(held()).toBe(false);
});
