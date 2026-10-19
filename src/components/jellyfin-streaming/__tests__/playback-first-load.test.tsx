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

const hls = vi.hoisted(() => ({ networkError: false }));
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
    once(_event: string, ready: () => void) { void Promise.resolve().then(ready); }
    loadSource() {
      // A connection-level failure: hls.js reports it with no HTTP status.
      if (hls.networkError) this.handlers.error?.('error', { type: 'networkError', details: 'fragLoadError', fatal: false, response: { code: 0 } });
    }
    attachMedia(el: HTMLMediaElement) { el.src = 'blob:test-hls'; }
    destroy() {}
  },
}));
// The start bound running out, without waiting 30 s for it.
vi.mock('@/lib/jellyfin-playback/play-media', () => ({
  playMedia: async () => { throw new Error('Playback did not start. Try again or choose another quality.'); },
}));

let h: Harness;
afterEach(() => {
  hls.networkError = false;
  h?.cleanup();
  vi.restoreAllMocks();
  getQueryClient().clear();
});

const START = 600 * 10_000_000;

async function startThatFails(options: { readyState: number }) {
  h = await mountPlayback({ hls: true });
  // The element is created on the first start; it reports what data it got.
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => options.readyState });
  await h.act(async () => { await h.playback().playItems([ITEM], 0, { startTimeTicks: START }); });
  await h.act(async () => { await vi.waitFor(() => expect(h.playback().status).toBe('error')); });
}

describe('a start that cannot get going', () => {
  it('stops after the first attempt when the stream could not be reached, and Retry starts it again from the same place', async () => {
    hls.networkError = true;
    await startThatFails({ readyState: 0 });

    expect(h.requests).toHaveLength(1);
    expect(h.playback().error).toBe("The stream couldn't be reached. Check the connection and try again.");

    await h.act(async () => { h.playback().retry(); });
    await h.act(async () => { await vi.waitFor(() => expect(h.requests).toHaveLength(2)); });
    expect(h.requests[1]).toEqual(expect.objectContaining({ itemId: ITEM.Id, startTimeTicks: START }));
  });

  it('still retries as a transcode when the stream was reachable', async () => {
    await startThatFails({ readyState: 0 });

    expect(h.requests).toHaveLength(2);
    expect(h.playback().error).toBe('Playback did not start. Try again or choose another quality.');
  });

  it('still retries as a transcode when data arrived but did not play', async () => {
    hls.networkError = true;
    await startThatFails({ readyState: 1 });

    expect(h.requests).toHaveLength(2);
  });
});
