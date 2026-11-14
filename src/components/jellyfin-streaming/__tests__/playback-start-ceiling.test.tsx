// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { getQueryClient } from '@/lib/query-client';
import { ITEM, mountPlayback, type Harness } from './playback-restart-harness';

/**
 * Automatic quality's first ceiling comes from timed downloads, as
 * jellyfin-web's does. A fixed 6 Mbps guess direct-played a 5 Mbps file over a
 * 1.5 Mbps link and took about 20 s to show a frame.
 */

let h: Harness;
afterEach(() => {
  h?.cleanup();
  vi.restoreAllMocks();
  getQueryClient().clear();
  // A picked quality is remembered there, and the next mount would start with it.
  localStorage.clear();
});

const PROBE = '/api/jellyfin/stream/bitrate-test';

/** Serve each speed test as pieces of 125 kB, `gapMs` apart. */
function serveProbe(gapMs: number) {
  const originalFetch = globalThis.fetch;
  const signals: (AbortSignal | undefined)[] = [];
  const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).startsWith(PROBE)) return originalFetch(input, init);
    const chunks = Number(new URL(String(input), 'http://helprr.test').searchParams.get('size')) / 125_000;
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (sent === chunks) { controller.close(); return; }
        if (sent > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
        sent += 1;
        controller.enqueue(new Uint8Array(125_000));
      },
    });
    signals.push(init?.signal ?? undefined);
    return Promise.resolve(new Response(body, { status: 200 }));
  });
  vi.stubGlobal('fetch', fetchSpy);
  return {
    signals,
    probes: () => fetchSpy.mock.calls.filter(([url]) => String(url).startsWith(PROBE)).length,
    sizes: () => fetchSpy.mock.calls
      .filter(([url]) => String(url).startsWith(PROBE))
      .map(([url]) => Number(new URL(String(url), 'http://helprr.test').searchParams.get('size'))),
    ceilings: () => fetchSpy.mock.calls
      .filter(([url]) => String(url) === '/api/jellyfin/stream/info')
      .map(([, init]) => JSON.parse(String(init?.body)).maxStreamingBitrate as number | undefined),
  };
}

it('measures the link before the first Automatic start and starts below a slow one', async () => {
  h = await mountPlayback();
  // About 8 Mbps: past the first test's 0.5 Mbps, so the 1 MB test runs too,
  // and short of its 20 Mbps, so the 3 MB one does not.
  const probe = serveProbe(150);

  await h.act(async () => { await h.playback().playItem(ITEM); });

  expect(h.playback().status).toBe('playing');
  expect(probe.sizes()).toEqual([500_000, 1_000_000]);
  const [first] = probe.ceilings();
  expect(first).toBeGreaterThanOrEqual(2_000_000);
  expect(first).toBeLessThan(6_000_000);
  expect(h.playback().effectiveMaxBitrate).toBe(first);

  // Trusted for an hour: a restart, or the next title 59 minutes on, does not measure again.
  await h.act(async () => { await h.playback().setAudioStream(2); });
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 59 * 60_000);
  await h.act(async () => { await h.playback().playItem({ ...ITEM, Id: 'item-2' }); });
  expect(probe.probes()).toBe(2);
  expect(probe.ceilings()).toEqual([first, first, first]);
});

it('raises the start on a fast link, up to the highest quality offered', async () => {
  h = await mountPlayback();
  const probe = serveProbe(1);

  await h.act(async () => { await h.playback().playItem(ITEM); });

  expect(probe.sizes()).toEqual([500_000, 1_000_000, 3_000_000]);
  expect(probe.ceilings()).toEqual([120_000_000]);
});

it('skips a bigger test that could not finish in time and keeps the smaller one', async () => {
  h = await mountPlayback();
  // 500 kB over 2.4 s: about 1.7 Mbps, at which 1 MB would take longer than a test may.
  const probe = serveProbe(800);

  await h.act(async () => { await h.playback().playItem(ITEM); });

  expect(probe.sizes()).toEqual([500_000]);
  const [first] = probe.ceilings();
  expect(first).toBeGreaterThan(720_000);
  expect(first).toBeLessThan(2_000_000);
});

it('does not measure for an explicit quality or for music', async () => {
  h = await mountPlayback({ audioIds: ['song'] });
  const probe = serveProbe(0);

  await h.act(async () => { await h.playback().playItem({ ...ITEM, Id: 'song', Type: 'Audio', MediaType: 'Audio' }); });
  await h.act(async () => { await h.playback().playItem(ITEM, { maxStreamingBitrate: 10_000_000 }); });

  expect(probe.probes()).toBe(0);
});

it('never measures for a restart of the title on the player, even once the measurement is old', async () => {
  h = await mountPlayback();
  const probe = serveProbe(150);
  await h.act(async () => { await h.playback().playItem(ITEM); });
  const [first] = probe.ceilings();
  expect(first).toBeLessThan(6_000_000);
  expect(probe.probes()).toBe(2);

  // Past the hour: a track change neither waits on a test nor loses the
  // ceiling the stream is running at.
  const later = Date.now() + 61 * 60_000;
  vi.spyOn(Date, 'now').mockReturnValue(later);
  await h.act(async () => { await h.playback().setAudioStream(2); });
  expect(probe.probes()).toBe(2);
  expect(probe.ceilings()).toEqual([first, first]);

  // A fresh pick of another title does measure again, the old result expired.
  await h.act(async () => { await h.playback().playItem({ ...ITEM, Id: 'item-2' }); });
  expect(probe.probes()).toBe(4);
});

it('measures again when the viewer picks Automatic, however recent the last test', async () => {
  h = await mountPlayback();
  const probe = serveProbe(150);
  await h.act(async () => { await h.playback().playItem(ITEM); });
  expect(probe.probes()).toBe(2);

  await h.act(async () => { await h.playback().setMaxBitrate(10_000_000); });
  expect(probe.probes()).toBe(2);
  expect(probe.ceilings().at(-1)).toBe(10_000_000);

  await h.act(async () => { await h.playback().setMaxBitrate(0); });
  expect(probe.probes()).toBe(4);
  expect(probe.ceilings().at(-1)).toBeLessThan(6_000_000);
  expect(h.playback().maxBitrate).toBe(0);
});

it('lets a quality picked during that test win over Automatic', async () => {
  h = await mountPlayback();
  const probe = serveProbe(150);
  await h.act(async () => { await h.playback().playItem(ITEM); });
  const before = probe.ceilings().length;

  let automatic!: Promise<void>;
  await h.act(() => { automatic = h.playback().setMaxBitrate(0); });
  await h.act(async () => { await h.playback().setMaxBitrate(8_000_000); await automatic; });

  expect(probe.ceilings().slice(before)).toEqual([8_000_000]);
  expect(h.playback().maxBitrate).toBe(8_000_000);
});

it('shares one test between starts that overlap it, and Stop cancels it', async () => {
  h = await mountPlayback();
  const probe = serveProbe(150);

  let firstStart!: Promise<void>;
  let secondStart!: Promise<void>;
  await h.act(() => { firstStart = h.playback().playItem(ITEM); });
  await h.act(() => { secondStart = h.playback().playItem({ ...ITEM, Id: 'item-2' }); });
  await h.act(async () => { await Promise.all([firstStart, secondStart]); });
  expect(probe.probes()).toBe(2);
  expect(h.playback().stream?.item.Id).toBe('item-2');

  // A test cut short by Stop measures nothing, so the next start tries again.
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61 * 60_000);
  let third!: Promise<void>;
  await h.act(() => { third = h.playback().playItem({ ...ITEM, Id: 'item-3' }); });
  await h.act(async () => { await h.playback().stop(); await third; });
  expect(probe.probes()).toBe(3);
  expect(probe.signals.at(-1)?.aborted).toBe(true);
  await h.act(async () => { await h.playback().playItem({ ...ITEM, Id: 'item-4' }); });
  expect(probe.probes()).toBe(5);
});

it('measures again after a network change, and after the page was hidden a long while', async () => {
  h = await mountPlayback();
  const probe = serveProbe(150);
  await h.act(async () => { await h.playback().playItem(ITEM); });
  expect(probe.probes()).toBe(2);

  await h.act(() => { window.dispatchEvent(new Event('online')); });
  await h.act(async () => { await h.playback().playItem({ ...ITEM, Id: 'item-2' }); });
  expect(probe.probes()).toBe(4);

  // Hidden five minutes: still trusted.
  const visibility = vi.spyOn(document, 'visibilityState', 'get');
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  visibility.mockReturnValue('hidden');
  await h.act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  clock.mockReturnValue(now + 5 * 60_000);
  visibility.mockReturnValue('visible');
  await h.act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await h.act(async () => { await h.playback().playItem({ ...ITEM, Id: 'item-3' }); });
  expect(probe.probes()).toBe(4);

  // Hidden eleven minutes: measured again (the iPhone has no change event).
  visibility.mockReturnValue('hidden');
  await h.act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  clock.mockReturnValue(now + 16 * 60_000);
  visibility.mockReturnValue('visible');
  await h.act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await h.act(async () => { await h.playback().playItem({ ...ITEM, Id: 'item-4' }); });
  expect(probe.probes()).toBe(6);
});

it('starts a restart no higher than the first guess once the network changed', async () => {
  h = await mountPlayback();
  serveProbe(1); // a fast LAN: 120 Mbps
  await h.act(async () => { await h.playback().playItem(ITEM); });
  const probe = serveProbe(1);
  await h.act(() => { window.dispatchEvent(new Event('online')); });
  await h.act(async () => { await h.playback().setAudioStream(2); });
  expect(probe.probes()).toBe(0); // a restart never waits on a test
  expect(probe.ceilings()).toEqual([6_000_000]);
});

it('does not let the test on picking Automatic lower the ceiling under a stream it cannot pause', async () => {
  h = await mountPlayback(); // a file: not hls.js, so its download keeps running
  serveProbe(1);
  await h.act(async () => { await h.playback().playItem(ITEM); });
  const slow = serveProbe(800); // the playing stream shares the link
  await h.act(async () => { await h.playback().setMaxBitrate(0); });
  expect(slow.probes()).toBe(1);
  expect(slow.ceilings()).toEqual([120_000_000]);
});
