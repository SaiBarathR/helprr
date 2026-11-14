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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage, getImageData: () => ({ data: Array(64).fill(90) }) } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  h?.cleanup();
  vi.restoreAllMocks();
  delete proto.videoWidth;
  delete proto.videoHeight;
  delete proto.requestVideoFrameCallback;
  delete proto.cancelVideoFrameCallback;
  getQueryClient().clear();
});

/** Safari's own HLS as the re-test saw it: requestVideoFrameCallback exists and never fires. */
function framesNeverReported() {
  proto.requestVideoFrameCallback = vi.fn(() => 1);
  proto.cancelVideoFrameCallback = vi.fn();
}
const holds = () => h.element().parentElement?.querySelectorAll('canvas[data-frame-hold]').length ?? 0;
/** Play, as the element reports it: `playing`, then the time moving. */
async function plays(to: number) {
  const el = h.element();
  await h.act(() => { h.playback().togglePause(); });
  await h.act(() => { el.dispatchEvent(new Event('playing')); });
  await h.act(() => { el.currentTime = to; el.dispatchEvent(new Event('timeupdate')); });
}

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

it('holds no frame for a seek, whose frame would show the old moment under the new time', async () => {
  // A progressive transcode restarts for a seek; its element counts from the start it was given.
  h = await mountPlayback({ progressive: true });
  await h.act(async () => { await h.playback().playItem(RESUME); });
  const el = h.element();
  el.currentTime = 5; // 605 s into the title
  el.dispatchEvent(new Event('timeupdate'));
  await h.act(() => { h.playback().togglePause(); });
  const before = h.requests.length;

  await h.act(async () => { await h.playback().seek(900); });
  expect(h.requests.length).toBe(before + 1);
  expect(h.requests.at(-1)?.startTimeTicks).toBe(900 * 10_000_000);
  expect(held()).toBe(false);

  // An audio change at the same moment still holds (the new element counts from 900 s).
  el.currentTime = 0;
  await h.act(async () => { await h.playback().setAudioStream(2); });
  expect(held()).toBe(true);
});

it('takes the frame down once Play moves the new stream, when presented frames are never reported', async () => {
  framesNeverReported();
  await pausedAt600();
  await h.act(async () => { await h.playback().setAudioStream(2); });
  expect(held()).toBe(true);

  // The reload finishes while paused: the frame stays (Safari shows none of its own).
  const el = h.element();
  await h.act(() => { el.dispatchEvent(new Event('loadeddata')); el.dispatchEvent(new Event('timeupdate')); });
  expect(held()).toBe(true);

  await plays(600.5);
  expect(held()).toBe(false);
});

it('takes a fresh frame for a change made after the stream played, not the first hold', async () => {
  framesNeverReported();
  await pausedAt600();
  await h.act(async () => { await h.playback().setAudioStream(2); });
  await plays(600.5);
  expect(held()).toBe(false);
  drawImage.mockClear();

  // 76 s on, playing: an audio change holds the frame of 676 s, not 600 s.
  const el = h.element();
  await h.act(() => { el.currentTime = 676; el.dispatchEvent(new Event('timeupdate')); });
  await h.act(async () => { await h.playback().setAudioStream(1); });
  expect(held()).toBe(true);
  expect(holds()).toBe(1);
  // One frame drawn from the video (the black check's 4×4 sample draws the canvas).
  expect(drawImage.mock.calls.filter(([source]) => source instanceof HTMLVideoElement)).toHaveLength(1);
  expect(h.requests.at(-1)?.startTimeTicks).toBe(676 * 10_000_000);
});

it('keeps the first frame for a second change made while the first is still loading', async () => {
  framesNeverReported();
  await pausedAt600();
  await h.act(async () => { await h.playback().setAudioStream(2); });
  drawImage.mockClear();
  await h.act(async () => { await h.playback().setAudioStream(1); });
  expect(holds()).toBe(1);
  expect(drawImage.mock.calls.filter(([source]) => source instanceof HTMLVideoElement)).toHaveLength(0);
});

it('takes the frame down a moment after playing even if the time never seems to move', async () => {
  framesNeverReported();
  await pausedAt600();
  await h.act(async () => { await h.playback().setAudioStream(2); });
  vi.useFakeTimers();
  try {
    const el = h.element();
    await h.act(() => { h.playback().togglePause(); el.dispatchEvent(new Event('playing')); });
    expect(held()).toBe(true);
    await h.act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(held()).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it('drops the frame for a seek within the stream', async () => {
  framesNeverReported();
  await pausedAt600();
  await h.act(async () => { await h.playback().setAudioStream(2); });
  expect(held()).toBe(true);
  await h.act(() => { h.playback().seek(900); });
  expect(held()).toBe(false);
});
