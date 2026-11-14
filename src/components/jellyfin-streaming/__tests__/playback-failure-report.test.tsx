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
    expect(stoppedReports()[0].positionTicks).toBe(1200 * 10_000_000);
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
