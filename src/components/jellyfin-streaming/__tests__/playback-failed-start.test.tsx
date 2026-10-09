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
