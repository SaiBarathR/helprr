// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getQueryClient } from '@/lib/query-client';
import { ITEM, mountPlayback, type Harness } from './playback-restart-harness';

/**
 * A track change while paused on an iPhone, where the stream is Safari's own
 * HLS. The Mac re-test of 1.16.0 (iOS 27 Simulator, a 4K transcode) saw the
 * held picture go black 2–4 s into the reload while still paused, and once
 * the title start playing by itself about 30 s after the change. A paused
 * element of Safari's own HLS shows nothing of a new stream until Play, even
 * once WebKit reports a frame presented or loaded; and a play() it was given
 * to make it load (muted, paused again at once) is applied asynchronously.
 */
vi.mock('@/lib/jellyfin-playback/browser', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/jellyfin-playback/browser')>();
  return {
    ...original,
    detectBrowser: () => original.detectBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'),
  };
});

let h: Harness;
const proto = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
/** The frame callbacks waiting on the element: WebKit's requestVideoFrameCallback. */
let frameCallbacks: Array<() => void> = [];
/** WebKit reports a frame presented, whether or not the picture shows it. */
const presentFrame = () => {
  const callbacks = frameCallbacks;
  frameCallbacks = [];
  callbacks.forEach((callback) => callback());
};
beforeEach(() => {
  Object.defineProperty(proto, 'videoWidth', { configurable: true, get: () => 1920 });
  Object.defineProperty(proto, 'videoHeight', { configurable: true, get: () => 1080 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: Array(64).fill(90) }) } as unknown as CanvasRenderingContext2D);
  frameCallbacks = [];
  proto.requestVideoFrameCallback = vi.fn((callback: () => void) => frameCallbacks.push(callback));
  proto.cancelVideoFrameCallback = vi.fn();
});
afterEach(() => {
  h?.cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete proto.videoWidth;
  delete proto.videoHeight;
  delete proto.requestVideoFrameCallback;
  delete proto.cancelVideoFrameCallback;
  getQueryClient().clear();
});

const RESUME = { ...ITEM, UserData: { PlaybackPositionTicks: 600 * 10_000_000 } } as typeof ITEM;
const held = () => h.element().nextElementSibling?.tagName === 'CANVAS';

/** A 4K transcode restart: each new source loads nothing until `load()`. */
function slowSource(el: HTMLVideoElement) {
  let readyState = 4;
  Object.defineProperty(el, 'readyState', { configurable: true, get: () => readyState });
  Object.defineProperty(el, 'src', {
    configurable: true,
    get: () => el.getAttribute('src') ?? '',
    set: (url: string) => { readyState = 0; el.setAttribute('src', url); },
  });
  return {
    loadMetadata: () => {
      readyState = 1;
      el.dispatchEvent(new Event('loadedmetadata'));
    },
  };
}

async function pausedAt600() {
  h = await mountPlayback({ hls: true });
  await h.act(async () => { await h.playback().playItem(RESUME); });
  const el = h.element();
  el.currentTime = 600;
  el.dispatchEvent(new Event('timeupdate'));
  await h.act(() => { h.playback().togglePause(); });
  expect(h.playback().status).toBe('paused');
}

it('keeps the paused picture through frames WebKit reports but does not show, until Play draws one', async () => {
  await pausedAt600();
  const el = h.element();
  const play = vi.spyOn(el, 'play');

  await h.act(async () => { await h.playback().setAudioStream(2); });
  expect(h.playback().status).toBe('paused');
  expect(held()).toBe(true);

  await h.act(() => { presentFrame(); });
  expect(held()).toBe(true);
  // Reported again while still paused: still nothing on screen.
  await h.act(() => { presentFrame(); });
  expect(held()).toBe(true);
  expect(play).not.toHaveBeenCalled();

  // Play, then the first frame of the new stream.
  await h.act(() => { h.playback().togglePause(); });
  expect(play).toHaveBeenCalledTimes(1);
  expect(held()).toBe(true);
  await h.act(() => { presentFrame(); });
  expect(held()).toBe(false);
});

it('never plays a paused change by itself, however long the new stream takes to load', async () => {
  await pausedAt600();
  const el = h.element();
  slowSource(el);
  const play = vi.spyOn(el, 'play');
  const before = h.reports.length;
  vi.useFakeTimers();

  await h.act(async () => {
    const change = h.playback().setAudioStream(2);
    await vi.advanceTimersByTimeAsync(60_000);
    await change;
  });

  expect(play).not.toHaveBeenCalled();
  expect(h.media.paused()).toBe(true);
  expect(h.playback().status).toBe('paused');
  expect(h.playback().error).toBeNull();
  expect(held()).toBe(true);
  expect(h.reports.slice(before)).toEqual([
    expect.objectContaining({ event: 'playing', isPaused: true }),
  ]);
});

it('keeps a paused seek made before the slow new stream has its metadata', async () => {
  await pausedAt600();
  const el = h.element();
  const source = slowSource(el);
  vi.useFakeTimers();
  await h.act(async () => {
    const change = h.playback().setAudioStream(2);
    await vi.advanceTimersByTimeAsync(5_000);
    await change;
  });
  expect(h.playback().status).toBe('paused');

  await h.act(() => { h.playback().seek(900); });
  await h.act(() => { source.loadMetadata(); });

  // Not back at 600 s, where the restart began.
  expect(el.currentTime).toBe(900);
  expect(h.playback().positionSeconds).toBe(900);
});

it('fails Play on a paused change whose stream never loads, after the 45 s limit', async () => {
  await pausedAt600();
  const el = h.element();
  slowSource(el);
  vi.useFakeTimers();
  await h.act(async () => {
    const change = h.playback().setAudioStream(2);
    await vi.advanceTimersByTimeAsync(5_000);
    await change;
  });
  expect(h.playback().status).toBe('paused');

  await h.act(() => { h.playback().togglePause(); });
  expect(h.playback().status).toBe('loading');
  await h.act(async () => { await vi.advanceTimersByTimeAsync(44_000); });
  expect(h.playback().error).toBeNull();

  await h.act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(h.playback().status).toBe('error');
  expect(h.playback().error).toBe('Playback did not start. Try again or choose another quality.');
});

it('leaves a Play alone once the new stream starts playing within the limit', async () => {
  await pausedAt600();
  const el = h.element();
  slowSource(el);
  vi.useFakeTimers();
  await h.act(async () => {
    const change = h.playback().setAudioStream(2);
    await vi.advanceTimersByTimeAsync(5_000);
    await change;
  });

  await h.act(() => { h.playback().togglePause(); });
  await h.act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  Object.defineProperty(el, 'readyState', { configurable: true, get: () => 4 });
  await h.act(() => { el.dispatchEvent(new Event('playing')); });
  await h.act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

  expect(h.playback().error).toBeNull();
  expect(h.playback().status).toBe('playing');
});
