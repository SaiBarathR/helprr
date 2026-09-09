// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { ITEM, mountPlayback, type Harness } from './playback-restart-harness';

let h: Harness;
afterEach(() => {
  h?.cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('recovers a silent readyState-zero load once, without reporting false playback', async () => {
  vi.useFakeTimers();
  h = await mountPlayback();
  let ready = 0;
  Object.defineProperty(h.element(), 'readyState', { configurable: true, get: () => ready });
  let pending!: Promise<void>;
  await h.act(() => { pending = h.playback().playItem({ ...ITEM, UserData: { PlaybackPositionTicks: 600_000_000 } } as typeof ITEM); });
  expect(h.playback().status).toBe('loading');
  await h.act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
  expect(h.reports).toEqual([]);
  expect(h.requests).toHaveLength(1);
  await h.act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(h.requests).toHaveLength(2);
  expect(h.requests[1].startTimeTicks).toBe(600_000_000);
  expect(h.encodingStops).toEqual(['session-1']);
  ready = 4;
  await h.act(async () => { await vi.advanceTimersByTimeAsync(250); await pending; });
  expect(h.playback().status).toBe('playing');
  expect(h.playback().stream?.playMethod).toBe('Transcode');
  expect(h.reports).toHaveLength(1);
  expect(h.reports[0].playSessionId).toBe('session-2');
});

it('surfaces an error if the fallback also never starts', async () => {
  vi.useFakeTimers();
  h = await mountPlayback();
  Object.defineProperty(h.element(), 'readyState', { configurable: true, value: 0 });
  let pending!: Promise<void>;
  await h.act(() => { pending = h.playback().playItem(ITEM); });
  await h.act(async () => { await vi.advanceTimersByTimeAsync(60_000); await pending; });
  expect(h.requests).toHaveLength(2);
  expect(h.playback().status).toBe('error');
  expect(h.playback().error).toContain('Playback did not start');
  expect(h.reports).toEqual([]);
  expect(h.media.paused()).toBe(true);
});

it('bounds a play promise that never settles', async () => {
  vi.useFakeTimers();
  h = await mountPlayback();
  vi.spyOn(h.element(), 'play').mockImplementationOnce(() => new Promise<void>(() => {}));
  let pending!: Promise<void>;
  await h.act(() => { pending = h.playback().playItem(ITEM); });
  await h.act(async () => { await vi.advanceTimersByTimeAsync(30_000); await pending; });
  expect(h.requests).toHaveLength(2);
  expect(h.playback().status).toBe('playing');
  expect(h.reports).toHaveLength(1);
});

it('never retries a silent load after Stop retires it', async () => {
  vi.useFakeTimers();
  h = await mountPlayback();
  Object.defineProperty(h.element(), 'readyState', { configurable: true, value: 0 });
  let pending!: Promise<void>;
  await h.act(() => { pending = h.playback().playItem(ITEM); });
  await h.act(async () => { await h.playback().stop(); });
  await h.act(async () => { await vi.advanceTimersByTimeAsync(60_000); await pending; });
  expect(h.requests).toHaveLength(1);
  expect(h.playback().status).toBe('idle');
  expect(h.reports.every((report) => report.event === 'stopped')).toBe(true);
});

it('keeps an autoplay rejection paused without treating it as a codec failure', async () => {
  h = await mountPlayback();
  vi.spyOn(h.element(), 'play').mockRejectedValueOnce(new DOMException('User gesture required', 'NotAllowedError'));
  await h.act(async () => { await h.playback().playItem(ITEM); });
  expect(h.requests).toHaveLength(1);
  expect(h.playback().status).toBe('paused');
  expect(h.reports[0]).toMatchObject({ event: 'playing', isPaused: true });
  await h.act(() => { h.playback().togglePause(); });
  expect(h.playback().status).toBe('playing');
});
