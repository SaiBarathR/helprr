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
