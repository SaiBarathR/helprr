// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getQueryClient } from '@/lib/query-client';
import { ITEM, mountPlayback, type Harness } from './playback-restart-harness';

vi.mock('@/lib/jellyfin-playback/browser', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/jellyfin-playback/browser')>();
  return {
    ...original,
    detectBrowser: () => original.detectBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'),
  };
});

let h: Harness;
afterEach(() => {
  h?.cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  getQueryClient().clear();
});

it('detaches a timed-out native HLS source and preserves the timeout after a late error, then allows Retry', async () => {
  vi.useFakeTimers();
  h = await mountPlayback({ hls: true });
  let ready = 0;
  Object.defineProperty(h.element(), 'readyState', { configurable: true, get: () => ready });
  const load = vi.spyOn(h.element(), 'load');
  let pending!: Promise<void>;
  await h.act(() => { pending = h.playback().playItem(ITEM); });
  expect(h.element().getAttribute('src')).toContain('.m3u8');
  await h.act(async () => { await vi.advanceTimersByTimeAsync(60_000); await pending; });
  const timeout = 'Playback did not start. Try again or choose another quality.';
  expect(h.playback().error).toBe(timeout);
  await h.act(() => { h.element().dispatchEvent(new Event('error')); });
  expect(h.playback().status).toBe('error');
  expect(h.playback().error).toBe(timeout);
  expect(h.element().hasAttribute('src')).toBe(false);
  expect(load).toHaveBeenCalled();
  expect(h.requests).toHaveLength(2);

  ready = 4;
  await h.act(() => { h.playback().retry(); });
  expect(h.playback().status).toBe('playing');
  expect(h.playback().error).toBeNull();
  expect(h.element().getAttribute('src')).toContain('.m3u8');
  await h.act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(h.reports.at(-1)).toMatchObject({ event: 'progress', playSessionId: 'session-3' });
});

for (const hls of [false, true]) {
  describe(hls ? 'native HLS' : 'direct play', () => {
    async function failedRestart() {
      h = await mountPlayback({ hls });
      await h.act(async () => { await h.playback().playItem(ITEM); });
      h.failStreamInfoFor(ITEM.Id);
      await h.act(async () => { await h.playback().setAudioStream(2); });
      expect(h.playback().status).toBe('error');
      expect(h.encodingStops).toContain('session-1');
    }

    it('keeps a failed same-item restart failed after late media events', async () => {
      await failedRestart();
      const error = h.playback().error;
      for (const event of ['pause', 'play', 'playing', 'waiting', 'timeupdate', 'ended', 'error']) {
        await h.act(() => { h.element().dispatchEvent(new Event(event)); });
        expect(h.playback().status, event).toBe('error');
        expect(h.playback().error, event).toBe(error);
      }
      expect(h.element().hasAttribute('src')).toBe(false);
    });

    it('reports the new session after a successful same-item restart', async () => {
      vi.useFakeTimers();
      h = await mountPlayback({ hls });
      await h.act(async () => { await h.playback().playItem(ITEM); });
      await h.act(async () => { await h.playback().setAudioStream(2); });
      expect(h.playback().status).toBe('playing');
      const before = h.reports.length;
      await h.act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(h.reports.slice(before)).toEqual([
        expect.objectContaining({ event: 'progress', playSessionId: 'session-2' }),
      ]);
    });

    it('sends no progress for the failed restart after a late pause', async () => {
      vi.useFakeTimers();
      await failedRestart();
      const before = h.reports.length;
      await h.act(() => { h.element().dispatchEvent(new Event('pause')); });
      await h.act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(h.reports.slice(before)).toEqual([]);
    });

    it('sends no progress or accepts outgoing events while a released session awaits replacement', async () => {
      vi.useFakeTimers();
      h = await mountPlayback({ hls });
      await h.act(async () => { await h.playback().playItem(ITEM); });
      // Prove the ordinary progress timer is active before releasing the session.
      await h.act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(h.reports.at(-1)?.event).toBe('progress');
      h.holdStreamInfo();
      let restarting!: Promise<void>;
      await h.act(() => { restarting = h.playback().setAudioStream(2); });
      expect(h.encodingStops).toContain('session-1');
      const before = h.reports.length;
      await h.act(() => {
        h.element().dispatchEvent(new Event('pause'));
        h.element().dispatchEvent(new Event('playing'));
      });
      expect(h.playback().status).toBe('loading');
      await h.act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(h.reports.slice(before)).toEqual([]);
      await h.act(async () => { h.releaseStreamInfo(); await restarting; });
      expect(h.playback().status).toBe('playing');
    });
  });
}

it('detaches and releases a terminal media error, and ignores its account check after a new start', async () => {
  vi.useFakeTimers();
  h = await mountPlayback({ hls: true, progressive: true });
  await h.act(async () => { await h.playback().playItem(ITEM); });
  const originalFetch = globalThis.fetch;
  let completeCheck!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === '/api/account/jellyfin/link'
      ? new Promise<Response>((resolve) => { completeCheck = resolve; })
      : originalFetch(input, init)));
  await h.act(() => { h.element().dispatchEvent(new Event('error')); });
  expect(h.playback().status).toBe('error');
  expect(h.element().hasAttribute('src')).toBe(false);
  expect(h.encodingStops).toContain('session-1');
  const before = h.reports.length;
  await h.act(() => { h.element().dispatchEvent(new Event('pause')); });
  await h.act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(h.reports.slice(before)).toEqual([]);

  await h.act(async () => { await h.playback().playItem(ITEM); });
  await h.act(() => { completeCheck(new Response(JSON.stringify({ connected: false }))); });
  expect(h.playback().status).toBe('playing');
  expect(h.playback().error).toBeNull();
  expect(h.playback().needsJellyfinConnect).toBe(false);
});

it.each([true, false])('waits for the account check before showing the terminal error (connected: %s)', async (connected) => {
  h = await mountPlayback({ progressive: true });
  await h.act(async () => { await h.playback().playItem(ITEM); });
  const originalFetch = globalThis.fetch;
  let completeCheck!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === '/api/account/jellyfin/link'
      ? new Promise<Response>((resolve) => { completeCheck = resolve; })
      : originalFetch(input, init)));

  await h.act(() => { h.element().dispatchEvent(new Event('error')); });

  expect(h.media.paused()).toBe(true);
  expect(h.element().hasAttribute('src')).toBe(false);
  expect(h.playback().error).toBeNull();
  await h.act(() => { completeCheck(new Response(JSON.stringify({ connected }))); });
  expect(h.playback().status).toBe('error');
  expect(h.playback().needsJellyfinConnect).toBe(!connected);
  expect(h.playback().error).toBe(connected ? 'This title could not be played.' : 'Connect your Jellyfin account to watch.');
});

it('does not report progress or accept events while a timed-out attempt is being released for fallback', async () => {
  vi.useFakeTimers();
  h = await mountPlayback();
  let ready = 2;
  Object.defineProperty(h.element(), 'readyState', { configurable: true, get: () => ready });
  h.holdStopRequests();
  let pending!: Promise<void>;
  await h.act(() => { pending = h.playback().playItem(ITEM); });
  await h.act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(h.encodingStops).toEqual(['session-1']);
  await h.act(() => {
    h.element().dispatchEvent(new Event('pause'));
    h.element().dispatchEvent(new Event('error'));
  });
  expect(h.playback().status).toBe('loading');
  await h.act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(h.reports).toEqual([]);
  ready = 4;
  await h.act(async () => { h.releaseEncodingStop(); await pending; });
  expect(h.playback().status).toBe('playing');
});
