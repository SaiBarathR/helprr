// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getQueryClient } from '@/lib/query-client';
import { ITEM, mountPlayback, type Harness } from './playback-restart-harness';

/**
 * What a start or stream that fails for good leaves behind: the words on
 * screen, and what Jellyfin is told.
 *
 * On native HLS (every iPhone) a stream that will not load rejects `play()`
 * with the browser's own DOMException, and its message — Safari's "The
 * operation is not supported." — was shown as the error. And a failure sent
 * Jellyfin no Stopped report, so it listed the title as playing, its position
 * frozen, until the viewer closed the player.
 */

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

const notSupported = () => new DOMException('The operation is not supported.', 'NotSupportedError');
const stoppedReports = () => h.reports.filter((report) => report.event === 'stopped');

/** Play `ITEM` and move its clock, as twenty minutes of watching would. */
async function watching(options: Parameters<typeof mountPlayback>[0] = {}, seconds = 1200) {
  h = await mountPlayback(options);
  await h.act(async () => { await h.playback().playItem(ITEM); });
  await h.act(() => {
    h.element().currentTime = seconds;
    h.element().dispatchEvent(new Event('timeupdate'));
  });
  expect(h.playback().status).toBe('playing');
}

describe('the message a failed start shows', () => {
  it("shows Helprr's wording, not the browser's, when native HLS rejects play()", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h = await mountPlayback({ hls: true });
    const cause = notSupported();
    h.element().play = () => Promise.reject(cause);

    await h.act(async () => { await h.playback().playItem(ITEM); });

    expect(h.playback().status).toBe('error');
    expect(h.playback().error).toBe('This title could not be played.');
    // The raw detail still reaches the client log.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[Jellyfin]'), cause);
  });

  it("shows Helprr's wording when a quality change's new stream will not load", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await watching({ hls: true });
    h.element().play = () => Promise.reject(notSupported());

    await h.act(async () => { await h.playback().setMaxBitrate(15_000_000); });

    expect(h.playback().status).toBe('error');
    expect(h.playback().error).toBe('This title could not be played.');
  });

  it("keeps the server's answer when there is one", async () => {
    h = await mountPlayback({ hls: true });
    h.failStreamInfoFor(ITEM.Id);

    await h.act(async () => { await h.playback().playItem(ITEM); });

    expect(h.playback().status).toBe('error');
    expect(h.playback().error).toBe('NoCompatibleStream');
  });

  it('still treats a blocked autoplay as a paused session, not a failure', async () => {
    h = await mountPlayback({ hls: true });
    h.element().play = () => Promise.reject(new DOMException('play() needs a gesture', 'NotAllowedError'));

    await h.act(async () => { await h.playback().playItem(ITEM); });

    expect(h.playback().status).toBe('paused');
    expect(h.playback().error).toBeNull();
    expect(stoppedReports()).toEqual([]);
  });

  it("does not show the network's own text when a queue cannot be prepared", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h = await mountPlayback();
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith('/api/jellyfin/catalog/items?')
        ? Promise.reject(new TypeError('Load failed'))
        : originalFetch(input, init)));

    await h.act(async () => { await h.playback().playItems([{ ...ITEM, Id: 'folder', Type: 'Folder', IsFolder: true }]); });

    expect(h.playback().status).toBe('error');
    expect(h.playback().error).toBe('Unable to prepare playback');
  });
});

describe('the Stopped report for a stream that failed for good', () => {
  it('is sent once, where the viewer was, when a same-item restart fails, and not again on Close', async () => {
    await watching();
    h.failStreamInfoFor(ITEM.Id);

    await h.act(async () => { await h.playback().setAudioStream(2); });

    expect(h.playback().status).toBe('error');
    await h.act(async () => {
      await vi.waitFor(() => expect(stoppedReports()).toEqual([
        expect.objectContaining({ playSessionId: 'session-1', positionTicks: 1200 * 10_000_000 }),
      ]));
    });

    await h.act(async () => { await h.playback().stop(); });
    expect(stoppedReports()).toHaveLength(1);
    expect(h.playback().status).toBe('idle');
  });

  it('is sent for the failed stream when native HLS cannot load the restarted one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await watching({ hls: true });
    h.element().play = () => Promise.reject(notSupported());

    await h.act(async () => { await h.playback().setMaxBitrate(15_000_000); });

    expect(h.playback().status).toBe('error');
    await h.act(async () => {
      await vi.waitFor(() => expect(stoppedReports()).toHaveLength(1));
    });
    // Under the session Jellyfin was told is playing, not the fallback the
    // failed restart opened (session-2, then session-3 after the transcode
    // retry); that one's encoder is released instead.
    expect(stoppedReports()[0]).toMatchObject({ playSessionId: 'session-1', positionTicks: 1200 * 10_000_000 });
    expect(h.encodingStops).toContain('session-3');
    await h.act(async () => { await h.playback().stop(); });
    expect(stoppedReports()).toHaveLength(1);
  });

  it('is sent once when a transcode fails mid-stream, before its encoder is released', async () => {
    await watching({ progressive: true });

    await h.act(() => { h.element().dispatchEvent(new Event('error')); });

    await h.act(async () => {
      await vi.waitFor(() => expect(h.encodingStops).toContain('session-1'));
    });
    expect(h.playback().error).toBe('This title could not be played.');
    expect(stoppedReports()).toEqual([
      expect.objectContaining({ playSessionId: 'session-1', positionTicks: 1200 * 10_000_000 }),
    ]);
    await h.act(async () => { await h.playback().stop(); });
    expect(stoppedReports()).toHaveLength(1);
  });

  it('leaves Retry its own session, which Close then reports', async () => {
    await watching();
    h.failStreamInfoFor(ITEM.Id);
    await h.act(async () => { await h.playback().setAudioStream(2); });
    await h.act(async () => { await vi.waitFor(() => expect(stoppedReports()).toHaveLength(1)); });
    h.restoreStreamInfoFor(ITEM.Id);

    await h.act(async () => {
      h.playback().retry();
      await vi.waitFor(() => expect(h.reports.at(-1)?.event).toBe('playing'));
    });
    expect(h.playback().status).toBe('playing');
    const session = h.playback().stream?.playSessionId;
    expect(session).not.toBe('session-1');
    expect(h.reports.at(-1)).toMatchObject({ event: 'playing', playSessionId: session });
    expect(h.requests.at(-1)?.startTimeTicks).toBe(1200 * 10_000_000);

    await h.act(async () => { await h.playback().stop(); });
    expect(stoppedReports()).toEqual([
      expect.objectContaining({ playSessionId: 'session-1' }),
      expect.objectContaining({ playSessionId: session }),
    ]);
  });
});

describe('after a failure that ended playback', () => {
  const sessionCounts = (list: string[]) => list.reduce<Record<string, number>>((all, id) => ({ ...all, [id]: (all[id] ?? 0) + 1 }), {});

  it('sends nothing on Close for a first start that never played, and releases nothing twice', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h = await mountPlayback({ hls: true });
    h.element().play = () => Promise.reject(notSupported());
    await h.act(async () => { await h.playback().playItem(ITEM); });
    expect(h.playback().status).toBe('error');

    await h.act(async () => { await h.playback().stop(); });

    expect(stoppedReports()).toEqual([]);
    expect(Object.values(sessionCounts(h.encodingStops)).every((count) => count === 1)).toBe(true);
  });

  it('does not report the failed title again when another one is picked', async () => {
    await watching();
    h.failStreamInfoFor(ITEM.Id);
    await h.act(async () => { await h.playback().setAudioStream(2); });
    await h.act(async () => { await vi.waitFor(() => expect(stoppedReports()).toHaveLength(1)); });

    const next = { ...ITEM, Id: 'item-2', Name: 'Next Episode' } as typeof ITEM;
    await h.act(async () => { await h.playback().playItem(next); });

    expect(h.playback().status).toBe('playing');
    expect(stoppedReports()).toHaveLength(1);
  });

  it('sends no beacon for it when the page goes away', async () => {
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: sendBeacon });
    try {
      await watching();
      h.failStreamInfoFor(ITEM.Id);
      await h.act(async () => { await h.playback().setAudioStream(2); });

      await h.act(() => { window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false })); });

      expect(sendBeacon).not.toHaveBeenCalled();
    } finally {
      delete (navigator as { sendBeacon?: unknown }).sendBeacon;
    }
  });

  it('sends its Stopped report and encoder release keepalive, so closing the app cannot drop them', async () => {
    await watching({ progressive: true });
    await h.act(() => { h.element().dispatchEvent(new Event('error')); });
    await h.act(async () => { await vi.waitFor(() => expect(h.encodingStops).toContain('session-1')); });

    const calls = vi.mocked(globalThis.fetch).mock.calls.filter(([url, init]) => (
      String(url).includes('/api/jellyfin/stream/stop-encodings')
      || (String(url).includes('/api/jellyfin/stream/session') && String(init?.body).includes('"stopped"'))
    ));
    expect(calls).toHaveLength(2);
    expect(calls.every(([, init]) => init?.keepalive === true)).toBe(true);
  });

  it('does not let a gathering run of skips restart the stream and clear the error', async () => {
    await watching({ progressive: true });
    await h.act(() => { h.playback().skip(10); });
    await h.act(() => { h.element().dispatchEvent(new Event('error')); });
    await h.act(async () => { await vi.waitFor(() => expect(h.encodingStops).toContain('session-1')); });
    const requests = h.requests.length;

    await h.act(async () => { await new Promise((resolve) => setTimeout(resolve, 1000)); });

    expect(h.requests).toHaveLength(requests);
    expect(h.playback().status).toBe('error');
    expect(h.playback().error).toBe('This title could not be played.');
  });

  it('reports nothing more when Retry fails again', async () => {
    await watching();
    h.failStreamInfoFor(ITEM.Id);
    await h.act(async () => { await h.playback().setAudioStream(2); });
    await h.act(async () => { await vi.waitFor(() => expect(stoppedReports()).toHaveLength(1)); });
    const requests = h.requests.length;

    await h.act(async () => { h.playback().retry(); await vi.waitFor(() => expect(h.requests.length).toBeGreaterThan(requests)); });
    await h.act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

    expect(h.playback().status).toBe('error');
    expect(stoppedReports()).toHaveLength(1);
    await h.act(async () => { await h.playback().stop(); });
    expect(stoppedReports()).toHaveLength(1);
    // session-1 was released by the track change; neither its failure, nor
    // Retry's, nor Close asks again.
    expect(h.encodingStops).toEqual(['session-1']);
  });

  it('releases a failed stream once when it fails twice', async () => {
    await watching({ progressive: true });
    await h.act(() => {
      h.element().dispatchEvent(new Event('error'));
      h.element().dispatchEvent(new Event('error'));
    });
    await h.act(async () => { await vi.waitFor(() => expect(h.encodingStops).toContain('session-1')); });
    await h.act(async () => { await h.playback().stop(); });
    expect(h.encodingStops).toEqual(['session-1']);
  });

  it("says the stream couldn't be reached, without a transcode retry, when the request itself fails", async () => {
    h = await mountPlayback();
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/api/jellyfin/stream/info'
        ? Promise.reject(new TypeError('Load failed'))
        : originalFetch(input, init));
    vi.stubGlobal('fetch', fetchSpy);

    await h.act(async () => { await h.playback().playItem(ITEM); });

    expect(h.playback().status).toBe('error');
    expect(h.playback().error).toBe("The stream couldn't be reached. Check the connection and try again.");
    expect(fetchSpy.mock.calls.filter(([url]) => String(url) === '/api/jellyfin/stream/info')).toHaveLength(1);
  });
});

describe('a track change while paused', () => {
  it("on an iPhone's native HLS is ready at metadata, without playing or waiting for a frame", async () => {
    await watching({ hls: true });
    await h.act(() => { h.playback().togglePause(); });
    // Safari stops a paused HLS element at metadata until play().
    Object.defineProperty(h.element(), 'readyState', { configurable: true, get: () => 1 });
    const play = vi.spyOn(h.element(), 'play');
    const started = Date.now();

    await h.act(async () => { await h.playback().setAudioStream(2); });

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(play).not.toHaveBeenCalled();
    expect(h.playback().status).toBe('paused');
  });

  it('loads the new stream without playing it, and reports it paused', async () => {
    await watching();
    await h.act(() => { h.playback().togglePause(); });
    expect(h.media.paused()).toBe(true);
    const play = vi.spyOn(h.element(), 'play');
    const before = h.reports.length;

    await h.act(async () => { await h.playback().setAudioStream(2); });

    expect(play).not.toHaveBeenCalled();
    expect(h.media.paused()).toBe(true);
    expect(h.playback().status).toBe('paused');
    // Jellyfin needs the new session's start report; it says paused.
    expect(h.reports.slice(before)).toEqual([
      expect.objectContaining({ event: 'playing', isPaused: true, playSessionId: 'session-2' }),
    ]);
  });
});
