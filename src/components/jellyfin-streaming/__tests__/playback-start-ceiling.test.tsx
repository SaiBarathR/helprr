// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { getQueryClient } from '@/lib/query-client';
import { ITEM, mountPlayback, type Harness } from './playback-restart-harness';

/**
 * Automatic quality's first ceiling comes from a timed download, as
 * jellyfin-web's does. A fixed 6 Mbps guess direct-played a 5 Mbps file over a
 * 1.5 Mbps link and took about 20 s to show a frame.
 */

let h: Harness;
afterEach(() => {
  h?.cleanup();
  vi.restoreAllMocks();
  getQueryClient().clear();
});

const PROBE = '/api/jellyfin/stream/bitrate-test';

/** Serve the probe as `chunks` pieces of 125 kB, `gapMs` apart. */
function serveProbe(chunks: number, gapMs: number) {
  const originalFetch = globalThis.fetch;
  const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).startsWith(PROBE)) return originalFetch(input, init);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (sent === chunks) { controller.close(); return; }
        if (sent > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
        sent += 1;
        controller.enqueue(new Uint8Array(125_000));
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  });
  vi.stubGlobal('fetch', fetchSpy);
  return {
    probes: () => fetchSpy.mock.calls.filter(([url]) => String(url).startsWith(PROBE)).length,
    ceilings: () => fetchSpy.mock.calls
      .filter(([url]) => String(url) === '/api/jellyfin/stream/info')
      .map(([, init]) => JSON.parse(String(init?.body)).maxStreamingBitrate as number | undefined),
  };
}

it('measures the link once before the first Automatic start and starts below a slow one', async () => {
  h = await mountPlayback();
  // 500 kB arriving over ~0.9 s: about 4.4 Mbps, so a ceiling near 60% of it.
  const probe = serveProbe(4, 300);

  await h.act(async () => { await h.playback().playItem(ITEM); });

  expect(h.playback().status).toBe('playing');
  expect(probe.probes()).toBe(1);
  const [first] = probe.ceilings();
  expect(first).toBeGreaterThanOrEqual(2_000_000);
  expect(first).toBeLessThan(6_000_000);
  expect(h.playback().effectiveMaxBitrate).toBe(first);

  // Trusted for a while: a restart, or the next title, does not measure again.
  await h.act(async () => { await h.playback().setAudioStream(2); });
  await h.act(async () => { await h.playback().playItem({ ...ITEM, Id: 'item-2' }); });
  expect(probe.probes()).toBe(1);
  expect(probe.ceilings()).toEqual([first, first, first]);
});

it('leaves a fast link exactly where Automatic started before', async () => {
  h = await mountPlayback();
  const probe = serveProbe(4, 0);

  await h.act(async () => { await h.playback().playItem(ITEM); });

  expect(probe.probes()).toBe(1);
  expect(probe.ceilings()).toEqual([6_000_000]);
});

it('does not measure for an explicit quality or for music', async () => {
  h = await mountPlayback({ audioIds: ['song'] });
  const probe = serveProbe(4, 0);

  await h.act(async () => { await h.playback().playItem({ ...ITEM, Id: 'song', Type: 'Audio', MediaType: 'Audio' }); });
  await h.act(async () => { await h.playback().playItem(ITEM, { maxStreamingBitrate: 10_000_000 }); });

  expect(probe.probes()).toBe(0);
});
