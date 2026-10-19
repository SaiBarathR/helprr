// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ITEM, mountPlayback, type Harness } from './playback-restart-harness';
import { getQueryClient } from '@/lib/query-client';

/**
 * A start that cannot get going. The start bound (playMedia) ends each attempt;
 * a failed direct stream is then retried as a transcode. When hls.js could not
 * reach the stream at all, that second attempt would fail the same way after
 * another full wait, so the player says so after the first.
 */

const hls = vi.hoisted(() => ({ networkError: null as string | null, recovers: false }));
const media = vi.hoisted(() => ({ startFails: true }));
vi.mock('@/lib/jellyfin-playback/browser', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/jellyfin-playback/browser')>(),
  canPlayHlsWithMse: () => true,
  canPlayNativeHls: () => false,
}));
vi.mock('hls.js', () => ({
  default: class {
    private handlers: Record<string, (event: string, data: unknown) => void> = {};
    static isSupported() { return true; }
    static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest', FRAG_LOADED: 'frag' };
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
    on(event: string, handler: (event: string, data: unknown) => void) { this.handlers[event] = handler; }
    once(_event: string, ready: () => void) {
      void Promise.resolve().then(() => {
        ready();
        // After the manifest: a fragment request fails (hls.js reports no HTTP status) ...
        if (hls.networkError) this.handlers.error?.('error', { type: 'networkError', details: hls.networkError, fatal: false, response: { code: 0 } });
        // ... and perhaps a later one loads.
        if (hls.recovers) this.handlers.frag?.('frag', { frag: { stats: { loaded: 1000, loading: { start: 0, end: 10 } } } });
      });
    }
    loadSource() {}
    attachMedia(el: HTMLMediaElement) { el.src = 'blob:test-hls'; }
    destroy() {}
  },
}));
// The start bound running out, without waiting 30 s for it.
vi.mock('@/lib/jellyfin-playback/play-media', () => ({
  playMedia: async (el: HTMLMediaElement) => {
    if (media.startFails) throw new Error('Playback did not start. Try again or choose another quality.');
    await el.play();
    return true;
  },
}));

let h: Harness;
afterEach(() => {
  hls.networkError = null;
  hls.recovers = false;
  media.startFails = true;
  h?.cleanup();
  vi.restoreAllMocks();
  getQueryClient().clear();
});

const START = 600 * 10_000_000;
const CONNECTION = "The stream couldn't be reached. Check the connection and try again.";

async function startThatFails(options: { readyState: number }) {
  h = await mountPlayback({ hls: true });
  // What data the element got.
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => options.readyState });
  await h.act(async () => { await h.playback().playItems([ITEM], 0, { startTimeTicks: START }); });
  await h.act(async () => { await vi.waitFor(() => expect(h.playback().status).toBe('error')); });
}

describe('a start that cannot get going', () => {
  it('stops after the first attempt when the stream could not be reached, and Retry starts it again from the same place', async () => {
    hls.networkError = 'fragLoadError';
    await startThatFails({ readyState: 0 });

    expect(h.requests).toHaveLength(1);
    expect(h.playback().error).toBe(CONNECTION);

    hls.networkError = null;
    await h.act(async () => { h.playback().retry(); });
    await h.act(async () => { await vi.waitFor(() => expect(h.requests.length).toBeGreaterThanOrEqual(2)); });
    expect(h.requests[1]).toEqual(expect.objectContaining({ itemId: ITEM.Id, startTimeTicks: START }));
    // That attempt saw no connection failure, so it falls back to a transcode as usual.
    await h.act(async () => { await vi.waitFor(() => expect(h.requests).toHaveLength(3)); });
  });

  it('still retries as a transcode when the stream was reachable', async () => {
    await startThatFails({ readyState: 0 });

    expect(h.requests).toHaveLength(2);
    expect(h.playback().error).toBe('Playback did not start. Try again or choose another quality.');
  });

  it('still retries as a transcode when data arrived but did not play', async () => {
    hls.networkError = 'fragLoadError';
    await startThatFails({ readyState: 1 });

    expect(h.requests).toHaveLength(2);
  });

  it('still retries as a transcode after a timeout, which a slow but reachable stream gives', async () => {
    hls.networkError = 'fragLoadTimeOut';
    await startThatFails({ readyState: 0 });

    expect(h.requests).toHaveLength(2);
  });

  it('still retries as a transcode when a later fragment loaded after the failure', async () => {
    hls.networkError = 'fragLoadError';
    hls.recovers = true;
    await startThatFails({ readyState: 0 });

    expect(h.requests).toHaveLength(2);
  });
});

describe('Retry after the title had played', () => {
  it('starts again where the viewer was, not where the title was first started', async () => {
    media.startFails = false;
    h = await mountPlayback({ hls: true });
    await h.act(async () => { await h.playback().playItems([ITEM], 0, { startTimeTicks: START }); });
    // Watched on to 20 minutes.
    await h.act(() => {
      h.element().currentTime = 1200;
      h.element().dispatchEvent(new Event('timeupdate'));
    });
    // A quality change whose negotiation fails.
    h.failStreamInfoFor(ITEM.Id);
    await h.act(async () => { await h.playback().setMaxBitrate(4_000_000); });
    await h.act(async () => { await vi.waitFor(() => expect(h.playback().status).toBe('error')); });

    const before = h.requests.length;
    await h.act(async () => { h.playback().retry(); });
    await h.act(async () => { await vi.waitFor(() => expect(h.requests.length).toBeGreaterThan(before)); });
    expect(h.requests.at(-1)).toEqual(expect.objectContaining({ itemId: ITEM.Id, startTimeTicks: 1200 * 10_000_000 }));
  });
});

describe('Retry after a failed seek or a paused restart', () => {
  it('retries a progressive seek that failed at its target, not where the stream had played to', async () => {
    media.startFails = false;
    h = await mountPlayback({ progressive: true });
    await h.act(async () => { await h.playback().playItems([ITEM], 0, { startTimeTicks: 0 }); });
    await h.act(() => {
      h.element().currentTime = 30;
      h.element().dispatchEvent(new Event('timeupdate'));
    });
    h.failStreamInfoFor(ITEM.Id);
    await h.act(async () => { h.playback().seek(600); });
    await h.act(async () => { await vi.waitFor(() => expect(h.playback().status).toBe('error')); });

    const before = h.requests.length;
    await h.act(async () => { h.playback().retry(); });
    await h.act(async () => { await vi.waitFor(() => expect(h.requests.length).toBeGreaterThan(before)); });
    expect(h.requests.at(-1)).toEqual(expect.objectContaining({ startTimeTicks: 600 * 10_000_000 }));
  });

  it('keeps a paused title paused when Retry succeeds', async () => {
    media.startFails = false;
    h = await mountPlayback({ hls: true });
    await h.act(async () => { await h.playback().playItems([ITEM], 0, { startTimeTicks: START }); });
    await h.act(async () => { h.playback().togglePause(); });
    await h.act(async () => { await vi.waitFor(() => expect(h.playback().status).toBe('paused')); });
    h.failStreamInfoFor(ITEM.Id);
    await h.act(async () => { await h.playback().setMaxBitrate(4_000_000); });
    await h.act(async () => { await vi.waitFor(() => expect(h.playback().status).toBe('error')); });

    h.restoreStreamInfoFor(ITEM.Id);
    await h.act(async () => { h.playback().retry(); });
    await h.act(async () => { await vi.waitFor(() => expect(h.playback().status).toBe('paused')); });
    expect(h.media.paused()).toBe(true);
  });
});
