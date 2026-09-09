// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ITEM, mountPlayback, type Harness } from './playback-restart-harness';
import { getQueryClient } from '@/lib/query-client';

let harness: Harness | null = null;

afterEach(() => {
  harness?.releaseStopReport();
  harness?.releaseEncodingStop();
  harness?.cleanup();
  harness = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
  getQueryClient().clear();
});

async function playing() {
  const h = await mountPlayback();
  harness = h;
  await h.act(async () => { await h.playback().playItem(ITEM); });
  return h;
}

describe('Stop responsiveness', () => {
  it('invalidates cached catalog details only after the stop report settles', async () => {
    const h = await playing();
    const client = getQueryClient();
    const keys = ['core', 'similar,trailers'].map((expand) => ['jellyfin', 'catalog', 'item', ITEM.Id, expand]);
    for (const key of keys) client.setQueryData(key, { item: ITEM });
    h.holdStopRequests();
    let stopped!: Promise<void>;
    await h.act(() => { stopped = h.playback().stop(); });
    expect(keys.every((key) => client.getQueryState(key)?.isInvalidated === false)).toBe(true);
    await h.act(async () => { h.releaseStopReport(); });
    expect(keys.every((key) => client.getQueryState(key)?.isInvalidated === true)).toBe(true);
    await h.act(async () => { h.releaseEncodingStop(); await stopped; });
  });

  it('pauses and clears the player before either stop request completes, preserving the final position', async () => {
    const h = await playing();
    h.element().currentTime = 123;
    h.holdStopRequests();
    let stopped!: Promise<void>;
    await h.act(() => { stopped = h.playback().stop(); });

    expect(h.media.paused()).toBe(true);
    expect(h.element().hasAttribute('src')).toBe(false);
    expect(h.playback().status).toBe('idle');
    expect(h.playback().item).toBeNull();
    expect(h.playback().queue).toEqual([]);
    expect(h.playback().videoExpanded).toBe(false);
    expect(h.reports.at(-1)).toMatchObject({ event: 'stopped', playSessionId: 'session-1', positionTicks: 1_230_000_000 });
    expect(h.encodingStops).toEqual([]);

    await h.act(async () => { h.releaseStopReport(); });
    expect(h.encodingStops).toEqual(['session-1']);
    expect(h.playback().status).toBe('idle');
    await h.act(async () => { h.releaseEncodingStop(); await stopped; });
  });

  it('keeps a newly started player alive when the old cleanup finishes', async () => {
    const h = await playing();
    h.holdStopRequests();
    let stopped!: Promise<void>;
    await h.act(() => { stopped = h.playback().stop(); });
    await h.act(async () => { await h.playback().playItem({ ...ITEM, Id: 'item-2' }); });
    expect(h.playback().stream?.playSessionId).toBe('session-2');

    await h.act(async () => { h.releaseStopReport(); });
    expect(h.encodingStops).toEqual(['session-1']);
    await h.act(async () => { h.releaseEncodingStop(); await stopped; });
    expect(h.media.paused()).toBe(false);
    expect(h.element().hasAttribute('src')).toBe(true);
    expect(h.playback().status).toBe('playing');
    expect(h.playback().stream?.playSessionId).toBe('session-2');
    expect(h.playback().item?.Id).toBe('item-2');
  });

  it('stays stopped when reporting and encoding cleanup fail', async () => {
    const h = await playing();
    vi.mocked(fetch).mockRejectedValue(new TypeError('Network unavailable'));
    await h.act(async () => { await h.playback().stop(); });
    expect(h.media.paused()).toBe(true);
    expect(h.playback().status).toBe('idle');
    expect(h.playback().stream).toBeNull();
  });

  it('retires a stream-info request still in flight', async () => {
    const h = await playing();
    h.holdStreamInfo();
    let pending!: Promise<void>;
    await h.act(() => { pending = h.playback().playItem({ ...ITEM, Id: 'item-2' }); });
    await h.act(async () => { await h.playback().stop(); });
    await h.act(async () => { h.releaseStreamInfo(); await pending; });
    expect(h.media.paused()).toBe(true);
    expect(h.playback().status).toBe('idle');
    expect(h.playback().stream).toBeNull();
    expect(h.encodingStops).toContain('session-2');
  });

  it('attempts encoding cleanup after a report timeout and bounds both requests', async () => {
    const h = await playing();
    vi.useFakeTimers();
    // Native AbortSignal.timeout uses an internal clock, so use the test clock
    // to exercise fetch aborts without making the suite wait twenty seconds.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
      return controller.signal;
    });
    h.holdStopRequests();
    let stopped!: Promise<void>;
    let finished = false;
    await h.act(() => { stopped = h.playback().stop().then(() => { finished = true; }); });
    expect(h.media.paused()).toBe(true);
    expect(h.encodingStops).toEqual([]);
    await h.act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(h.encodingStops).toEqual(['session-1']);
    expect(finished).toBe(false);
    await h.act(async () => { await vi.advanceTimersByTimeAsync(10_000); await stopped; });
    expect(finished).toBe(true);
    expect(h.playback().status).toBe('idle');
  });

  it('does not send duplicate reports when Stop is clicked twice during cleanup', async () => {
    const h = await playing();
    h.holdStopRequests();
    let first!: Promise<void>;
    await h.act(() => { first = h.playback().stop(); });
    await h.act(async () => { await h.playback().stop(); });
    expect(h.reports.filter(({ event }) => event === 'stopped')).toHaveLength(1);
    await h.act(async () => { h.releaseStopReport(); h.releaseEncodingStop(); await first; });
    expect(h.encodingStops).toEqual(['session-1']);
  });
});
