// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { getQueryClient } from '@/lib/query-client';
import { ITEM, mountPlayback, type Harness } from './playback-restart-harness';

/**
 * Picking Automatic tests the link again first. With hls.js the stream on
 * screen stops loading for the test, so it does not share the link and make
 * it read slow; the restart that follows replaces it. A pick made during the
 * test wins, and the stopped stream is never set loading again behind it.
 */

const hls = vi.hoisted(() => ({ instances: [] as Array<{ stopLoad: ReturnType<typeof vi.fn>; startLoad: ReturnType<typeof vi.fn>; destroyed: boolean }> }));
vi.mock('@/lib/jellyfin-playback/browser', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/jellyfin-playback/browser')>(),
  canPlayHlsWithMse: () => true,
  canPlayNativeHls: () => false,
}));
vi.mock('hls.js', async () => {
  const { vi: mock } = await import('vitest');
  return {
    default: class {
      stopLoad = mock.fn();
      startLoad = mock.fn();
      destroyed = false;
      constructor() { hls.instances.push(this); }
      static isSupported() { return true; }
      static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest', FRAG_LOADED: 'frag' };
      on() {}
      once(_event: string, ready: () => void) { void Promise.resolve().then(ready); }
      loadSource() {}
      attachMedia(el: HTMLMediaElement) { el.src = 'blob:test-hls'; }
      destroy() { this.destroyed = true; }
    },
  };
});

let h: Harness;
afterEach(() => {
  h?.cleanup();
  hls.instances = [];
  vi.restoreAllMocks();
  getQueryClient().clear();
  localStorage.clear();
});

const PROBE = '/api/jellyfin/stream/bitrate-test';
/** Serve each speed test as pieces of 125 kB, `gapMs` apart; returns the stream/info ceilings asked. */
function serveProbe(gapMs: number) {
  const originalFetch = globalThis.fetch;
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).startsWith(PROBE)) return originalFetch(input, init);
    const chunks = Number(new URL(String(input), 'http://helprr.test').searchParams.get('size')) / 125_000;
    let sent = 0;
    return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (sent === chunks) { controller.close(); return; }
        if (sent > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
        sent += 1;
        controller.enqueue(new Uint8Array(125_000));
      },
    }), { status: 200 }));
  });
  vi.stubGlobal('fetch', spy);
  return () => spy.mock.calls
    .filter(([url]) => String(url) === '/api/jellyfin/stream/info')
    .map(([, init]) => JSON.parse(String(init?.body)).maxStreamingBitrate as number);
}

it('stops hls.js loading for the test, then replaces the stream at the new ceiling', async () => {
  h = await mountPlayback({ hls: true });
  serveProbe(150);
  await h.act(async () => { await h.playback().playItem(ITEM, { maxStreamingBitrate: 10_000_000 }); });
  const [outgoing] = hls.instances;
  const ceilings = serveProbe(150);

  await h.act(async () => { await h.playback().setMaxBitrate(0); });

  expect(outgoing.stopLoad).toHaveBeenCalledTimes(1);
  expect(outgoing.startLoad).not.toHaveBeenCalled();
  expect(outgoing.destroyed).toBe(true);
  expect(hls.instances).toHaveLength(2);
  expect(ceilings()).toHaveLength(1);
  expect(ceilings()[0]).toBeLessThan(10_000_000); // the ~8 Mbps test, not a stalled-link reading
});

it('lets a quality picked during the test win, without setting the stopped stream loading again', async () => {
  h = await mountPlayback({ hls: true });
  serveProbe(150);
  await h.act(async () => { await h.playback().playItem(ITEM, { maxStreamingBitrate: 10_000_000 }); });
  const [outgoing] = hls.instances;
  const ceilings = serveProbe(150);

  // The manual pick's restart is held at releasing the outgoing encoder, so
  // the stream on screen (and hls.js on it) is still the stopped one when
  // the Automatic test resolves: the moment a superseded pick used to set it
  // loading again.
  let automatic!: Promise<void>;
  let manual!: Promise<void>;
  await h.act(() => { automatic = h.playback().setMaxBitrate(0); });
  h.holdStopRequests();
  await h.act(() => { manual = h.playback().setMaxBitrate(8_000_000); });
  await h.act(async () => { await automatic; });
  expect(outgoing.destroyed).toBe(false);
  expect(outgoing.stopLoad).toHaveBeenCalledTimes(1);
  expect(outgoing.startLoad).not.toHaveBeenCalled();

  await h.act(async () => { h.releaseEncodingStop(); h.releaseStopReport(); await manual; });
  expect(hls.instances.every((instance) => instance.startLoad.mock.calls.length === 0)).toBe(true);
  expect(outgoing.destroyed).toBe(true);
  expect(ceilings()).toEqual([8_000_000]);
  expect(h.playback().maxBitrate).toBe(8_000_000);
});
