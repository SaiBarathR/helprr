// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ITEM, mountPlayback, type Harness } from './playback-restart-harness';
import { getQueryClient } from '@/lib/query-client';

/**
 * The stretch between picking another item and its stream arriving, and what
 * is left when that stream never does.
 *
 * Until the new item's negotiation resolves, the stream and the clock on the
 * player still belong to the outgoing item. Two things went wrong there: a
 * failed negotiation left the outgoing stream in place under the new item's
 * title and error, where Play resumed it and Stop reported it; and Previous
 * read the outgoing item's clock and rewound it instead of going back.
 */

const NEXT = { ...ITEM, Id: 'item-2', Name: 'Next Episode' } as typeof ITEM;

let h: Harness;
afterEach(() => {
  h?.cleanup();
  vi.restoreAllMocks();
  getQueryClient().clear();
});

/** Play `ITEM` and move its clock, as twenty minutes of watching would. */
async function watching(seconds: number, startTimeTicks = 0) {
  h = await mountPlayback();
  await h.act(async () => { await h.playback().playItems([ITEM, NEXT], 0, { startTimeTicks }); });
  await h.act(() => {
    h.element().currentTime = seconds;
    h.element().dispatchEvent(new Event('timeupdate'));
  });
  expect(h.playback().positionSeconds).toBe(seconds);
  return h;
}

describe('a start that fails after another item was playing', () => {
  it("clears the outgoing item's stream and clock instead of leaving them under the error", async () => {
    await watching(1200, 600 * 10_000_000);
    h.failStreamInfoFor(NEXT.Id);

    await h.act(async () => { await h.playback().next(); });

    expect(h.playback().status).toBe('error');
    expect(h.playback().item?.Id).toBe(NEXT.Id);
    expect(h.playback().stream).toBeNull();
    expect(h.playback().positionSeconds).toBe(0);
    expect(h.playback().durationSeconds).toBe(0);
    // The outgoing item's encoder is still released.
    expect(h.encodingStops).toContain('session-1');
    // And Jellyfin is told it stopped, where it was, so the device is not left
    // listed as playing it until something else plays there.
    await h.act(async () => {
      await vi.waitFor(() => expect(h.reports.filter((report) => report.event === 'stopped')).toEqual([
        expect.objectContaining({ playSessionId: 'session-1', positionTicks: 1200 * 10_000_000 }),
      ]));
    });

    // Play must not resume the item that was replaced.
    await h.act(() => { h.playback().togglePause(); });
    expect(h.media.paused()).toBe(true);

    // Stop has nothing of the failed item to report, and must not report the
    // outgoing one at the position it was started from.
    const reportsBefore = h.reports.length;
    await h.act(async () => { await h.playback().stop(); });
    expect(h.reports.slice(reportsBefore)).toEqual([]);
    expect(h.playback().status).toBe('idle');
  });

  it("keeps the stream and position when it is the same item's restart that fails", async () => {
    await watching(1200);
    h.failStreamInfoFor(ITEM.Id);

    await h.act(async () => { await h.playback().setAudioStream(2); });

    expect(h.playback().status).toBe('error');
    expect(h.playback().item?.Id).toBe(ITEM.Id);
    expect(h.playback().stream?.item.Id).toBe(ITEM.Id);
    expect(h.playback().positionSeconds).toBe(1200);
  });

  it('reports and detaches the outgoing item when Next requires a Jellyfin connection', async () => {
    await watching(1200);
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/api/jellyfin/stream/info'
        ? Promise.resolve(new Response(JSON.stringify({ error: 'jellyfin_connect_required' }), { status: 409 }))
        : originalFetch(input, init)));
    const load = vi.spyOn(h.element(), 'load');

    await h.act(async () => { await h.playback().next(); });

    expect(h.playback().needsJellyfinConnect).toBe(true);
    expect(h.playback().videoExpanded).toBe(true);
    expect(h.playback().status).toBe('error');
    expect(h.playback().stream).toBeNull();
    expect(h.playback().positionSeconds).toBe(0);
    expect(h.media.paused()).toBe(true);
    expect(h.element().hasAttribute('src')).toBe(false);
    expect(load).toHaveBeenCalled();
    await h.act(async () => {
      await vi.waitFor(() => expect(h.encodingStops).toEqual(['session-1']));
    });
    expect(h.reports.filter((report) => report.event === 'stopped')).toEqual([
      expect.objectContaining({ playSessionId: 'session-1', positionTicks: 1200 * 10_000_000 }),
    ]);
  });
});

describe('queue preparation that cannot start an item', () => {
  it.each([
    { type: 'Folder', result: 'reject', shuffle: false },
    { type: 'Series', result: 'http', shuffle: true },
  ])('stops the outgoing item after $type expansion returns $result (shuffle: $shuffle)', async ({ type, result, shuffle }) => {
    await watching(1200, 600 * 10_000_000);
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).startsWith('/api/jellyfin/catalog/items?')) return originalFetch(input, init);
      if (result === 'reject') return Promise.reject(new Error('Network unavailable'));
      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: result === 'http' ? 503 : 200 }));
    }));
    const load = vi.spyOn(h.element(), 'load');
    const container = { ...ITEM, Id: 'container', Type: type, IsFolder: true };

    await h.act(async () => { await h.playback().playItems([container], 0, { shuffle }); });

    expect(h.media.paused()).toBe(true);
    expect(h.element().hasAttribute('src')).toBe(false);
    expect(load).toHaveBeenCalled();
    expect(h.playback().status).toBe('error');
    expect(h.playback().error).toBe(result === 'reject' ? 'Network unavailable' : 'Unable to load the playback queue');
    expect(h.playback().item?.Id).toBe(container.Id);
    expect(h.playback().stream).toBeNull();
    expect(h.playback().positionSeconds).toBe(0);
    expect(h.playback().durationSeconds).toBe(0);
    expect(h.requests).toHaveLength(1);
    await h.act(async () => {
      await vi.waitFor(() => expect(h.encodingStops).toEqual(['session-1']));
    });
    expect(h.reports.filter((report) => report.event === 'stopped')).toEqual([
      expect.objectContaining({ playSessionId: 'session-1', positionTicks: 1200 * 10_000_000 }),
    ]);
    await h.act(() => { h.playback().togglePause(); });
    expect(h.media.paused()).toBe(true);
    expect(h.playback().status).toBe('error');
    await h.act(async () => { await h.playback().stop(); });
    expect(h.reports.filter((report) => report.event === 'stopped')).toHaveLength(1);
  });

  it('keeps playing a concrete item when only its optional show expansion fails', async () => {
    h = await mountPlayback();
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith('/api/jellyfin/catalog/items?')
        ? Promise.reject(new Error('Network unavailable'))
        : originalFetch(input, init)));

    await h.act(async () => { await h.playback().playItem({ ...ITEM, SeriesId: 'series' }); });

    expect(h.playback().status).toBe('playing');
    expect(h.media.paused()).toBe(false);
    expect(h.encodingStops).toEqual([]);
    await h.act(() => { h.playback().togglePause(); });
    expect(h.playback().status).toBe('paused');
  });
});

describe('Previous while the next item is still being negotiated', () => {
  it('goes back to the item that was playing rather than rewinding it', async () => {
    await watching(600);
    h.holdStreamInfo();

    let goingNext!: Promise<void>;
    await h.act(() => { goingNext = h.playback().next(); });
    expect(h.playback().index).toBe(1);

    let goingBack!: Promise<void>;
    await h.act(() => { goingBack = h.playback().previous(); });
    // Before the fix this stayed on 1: the press was spent rewinding ITEM.
    expect(h.playback().index).toBe(0);

    await h.act(async () => { h.releaseStreamInfo(); await goingNext; await goingBack; });

    expect(h.playback().status).toBe('playing');
    expect(h.playback().item?.Id).toBe(ITEM.Id);
    expect(h.playback().stream?.item.Id).toBe(ITEM.Id);
    expect(h.requests.at(-1)?.itemId).toBe(ITEM.Id);
  });

  it('still rewinds the item that is actually playing', async () => {
    await watching(600);
    await h.act(async () => { await h.playback().next(); });
    await h.act(() => {
      h.element().currentTime = 30;
      h.element().dispatchEvent(new Event('timeupdate'));
    });

    await h.act(async () => { await h.playback().previous(); });

    expect(h.playback().index).toBe(1);
    expect(h.media.currentTime()).toBe(0);
  });
});

describe('Stop while the next item is still being negotiated', () => {
  it('reports the outgoing item where it was paused, not where it was started', async () => {
    // Resumed at ten minutes, watched to twenty, then paused: a paused element
    // sends no more time updates, so nothing re-marks it as past its start.
    await watching(1200, 600 * 10_000_000);
    await h.act(() => { h.playback().togglePause(); });
    expect(h.media.paused()).toBe(true);
    h.holdStreamInfo();

    let goingNext!: Promise<void>;
    await h.act(() => { goingNext = h.playback().next(); });
    const reportsBefore = h.reports.length;
    await h.act(async () => { await h.playback().stop(); });

    const stopped = h.reports.slice(reportsBefore).filter((report) => report.event === 'stopped');
    expect(stopped).toHaveLength(1);
    // Before the fix this was the ten minutes it had been started from, which
    // moved the member's resume point back.
    expect(stopped[0]).toMatchObject({ playSessionId: 'session-1', positionTicks: 1200 * 10_000_000 });

    await h.act(async () => { h.releaseStreamInfo(); await goingNext; });
  });
});

describe('Seeking a progressive transcode while the next item is still being negotiated', () => {
  it('leaves the incoming item to its own start', async () => {
    await watching(600);
    // A media error on a direct stream falls back to a transcode, which this
    // harness serves as a plain file: the one case where a seek is a restart.
    await h.act(async () => {
      h.element().dispatchEvent(new Event('error'));
      await vi.waitFor(() => expect(h.playback().stream?.playMethod).toBe('Transcode'));
    });
    h.holdStreamInfo();

    let goingNext!: Promise<void>;
    await h.act(() => { goingNext = h.playback().next(); });
    const stopsBefore = h.encodingStops.length;
    await h.act(async () => {
      h.playback().seek(100);
      // Long enough for the restart this used to begin to reach its request.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // The outgoing encoder is not stopped by the seek either.
    expect(h.encodingStops.slice(stopsBefore)).toEqual([]);

    await h.act(async () => { h.releaseStreamInfo(); await goingNext; });

    // Before the fix a second request asked for NEXT at 100 seconds, with the
    // outgoing item's source id, and took the player from the first.
    expect(h.requests.filter((request) => request.itemId === NEXT.Id)).toEqual([
      expect.objectContaining({ itemId: NEXT.Id, startTimeTicks: 0 }),
    ]);
    expect(h.playback().status).toBe('playing');
    expect(h.playback().stream?.item.Id).toBe(NEXT.Id);
  });
});

describe('A media error on the outgoing item while the next one is still being negotiated', () => {
  it('leaves the incoming item to its own start', async () => {
    await watching(1200, 600 * 10_000_000);
    h.holdStreamInfo();

    let goingNext!: Promise<void>;
    await h.act(() => { goingNext = h.playback().next(); });
    const stopsBefore = h.encodingStops.length;
    await h.act(async () => {
      h.element().dispatchEvent(new Event('error'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(h.encodingStops.slice(stopsBefore)).toEqual([]);

    await h.act(async () => { h.releaseStreamInfo(); await goingNext; });

    // Before the fix the recovery asked for NEXT at the outgoing item's
    // position, as a transcode, and took the player from the first request.
    expect(h.requests.filter((request) => request.itemId === NEXT.Id)).toEqual([
      expect.objectContaining({ itemId: NEXT.Id, startTimeTicks: 0 }),
    ]);
    expect(h.playback().status).toBe('playing');
    expect(h.playback().stream).toMatchObject({ item: { Id: NEXT.Id }, playMethod: 'DirectPlay' });
  });
});

describe('Seeking a direct stream while the next item is still being negotiated', () => {
  it('leaves the title the viewer has left where it is', async () => {
    await watching(600);
    h.holdStreamInfo();

    let goingNext!: Promise<void>;
    await h.act(() => { goingNext = h.playback().next(); });
    await h.act(() => { h.playback().seek(100); });
    // Before the fix this moved the outgoing element and its clock to 100.
    expect(h.media.currentTime()).toBe(600);
    expect(h.playback().positionSeconds).toBe(600);

    await h.act(async () => { h.releaseStreamInfo(); await goingNext; });
    expect(h.playback().stream?.item.Id).toBe(NEXT.Id);
    expect(h.requests.filter((request) => request.itemId === NEXT.Id)).toEqual([
      expect.objectContaining({ itemId: NEXT.Id, startTimeTicks: 0 }),
    ]);
  });
});

describe('A start superseded by Stop', () => {
  it("releases only its own grant, leaving the outgoing encoder to Stop", async () => {
    await watching(600);
    h.holdStreamInfo();

    let goingNext!: Promise<void>;
    await h.act(() => { goingNext = h.playback().next(); });
    await h.act(async () => { await h.playback().stop(); });
    await h.act(async () => { h.releaseStreamInfo(); await goingNext; });

    // Stop released session-1. Before the fix the superseded start released it
    // a second time on its way out.
    expect(h.encodingStops.filter((session) => session === 'session-1')).toHaveLength(1);
    expect(h.encodingStops).toContain('session-2');
    expect(h.playback().status).toBe('idle');
  });
});
