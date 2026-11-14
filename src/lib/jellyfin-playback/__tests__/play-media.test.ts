import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAUSED_START, playMedia } from '../play-media';

/** Just what `playMedia` reads and calls on a media element. */
function fakeElement(readyState: number) {
  return {
    readyState,
    muted: false,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
  } as unknown as HTMLMediaElement & { readyState: number; muted: boolean; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> };
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

  it('waits out a slow native transcode without playing, then nudges it muted and leaves it paused', async () => {
    const el = fakeElement(0);
    let mutedAtPlay: boolean | undefined;
    el.play.mockImplementation(() => { mutedAtPlay = el.muted; return Promise.resolve(); });
    let ready: boolean | undefined;
    void playMedia(el, () => true, 30_000, PAUSED_START.native).then((value) => { ready = value; });

    // A fresh transcode's playlist can take seconds on cellular: no play() yet.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(el.play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PAUSED_START.native.fallbackMs - 1_500);

    expect(el.play).toHaveBeenCalledTimes(1);
    expect(mutedAtPlay).toBe(true);
    expect(el.pause).toHaveBeenCalledTimes(1);
    expect(el.muted).toBe(false);
    expect(ready).toBeUndefined();
    el.readyState = 1;
    await vi.advanceTimersByTimeAsync(250);
    expect(ready).toBe(true);
  });

  it('hands back a mute that was already on', async () => {
    const el = fakeElement(0);
    el.muted = true;
    void playMedia(el, () => true, 30_000, PAUSED_START.native);
    await vi.advanceTimersByTimeAsync(PAUSED_START.native.fallbackMs);
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(el.muted).toBe(true);
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
