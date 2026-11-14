import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAUSED_START, playMedia } from '../play-media';

/** Just what `playMedia` reads and calls on a media element. */
function fakeElement(readyState: number) {
  return {
    readyState,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
  } as unknown as HTMLMediaElement & { readyState: number; play: ReturnType<typeof vi.fn> };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('a paused start', () => {
  it('on Safari\'s own HLS is ready at metadata, without playing and without waiting', async () => {
    const el = fakeElement(1);
    let ready: boolean | undefined;
    void playMedia(el, () => true, 30_000, PAUSED_START.native).then((value) => { ready = value; });
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toBe(true);
    expect(el.play).not.toHaveBeenCalled();
  });

  it('elsewhere waits for a frame, then is ready without playing', async () => {
    const el = fakeElement(1);
    let ready: boolean | undefined;
    void playMedia(el, () => true, 30_000, PAUSED_START.buffered).then((value) => { ready = value; });
    await vi.advanceTimersByTimeAsync(500);
    expect(ready).toBeUndefined();
    el.readyState = 2;
    await vi.advanceTimersByTimeAsync(250);
    expect(ready).toBe(true);
    expect(el.play).not.toHaveBeenCalled();
  });

  it('plays after all when native HLS has loaded nothing by its short fallback', async () => {
    const el = fakeElement(0);
    void playMedia(el, () => true, 30_000, PAUSED_START.native);
    await vi.advanceTimersByTimeAsync(PAUSED_START.native.fallbackMs - 1);
    expect(el.play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(el.play).toHaveBeenCalledTimes(1);
  });

  it('a playing start still plays at once', async () => {
    const el = fakeElement(4);
    let ready: boolean | undefined;
    void playMedia(el, () => true).then((value) => { ready = value; });
    await vi.advanceTimersByTimeAsync(0);
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(ready).toBe(true);
  });
});
