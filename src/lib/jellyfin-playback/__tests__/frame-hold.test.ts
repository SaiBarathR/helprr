// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOLD_PIXEL_BUDGET, holdFrame, PLAYING_RELEASE_MS, whenFramePresented } from '../frame-hold';

function video({ readyState = 4, width = 1920, height = 1080, box = [0, 0] } = {}) {
  const host = document.createElement('div');
  const el = document.createElement('video');
  Object.defineProperty(el, 'readyState', { value: readyState });
  Object.defineProperty(el, 'videoWidth', { value: width });
  Object.defineProperty(el, 'videoHeight', { value: height });
  Object.defineProperty(el, 'clientWidth', { value: box[0] });
  Object.defineProperty(el, 'clientHeight', { value: box[1] });
  host.append(el);
  document.body.append(host);
  return el;
}

const drawImage = vi.fn();
/** A frame with picture in it, unless `black`. */
let black = false;
const getImageData = vi.fn(() => ({ data: Array.from({ length: 16 }, (_, i) => (black || i !== 9 ? [0, 0, 0, 255] : [120, 80, 40, 255])).flat() }));
const context = () => ({ drawImage, getImageData }) as unknown as CanvasRenderingContext2D;
/** The draws of the video itself, not of the 4×4 sample the black check reads. */
const frameDraw = () => drawImage.mock.calls.filter(([source]) => source instanceof HTMLVideoElement).at(-1);
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  drawImage.mockReset();
  getImageData.mockClear();
  black = false;
  document.body.innerHTML = '';
});

describe('holdFrame', () => {
  it('draws the frame on screen into a canvas over the element, and frees it on release', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context());
    const el = video();
    const hold = holdFrame(el);
    const canvas = el.nextElementSibling as HTMLCanvasElement;
    expect(canvas.tagName).toBe('CANVAS');
    expect(drawImage).toHaveBeenCalledWith(el, 0, 0, 1920, 1080);
    expect([canvas.width, canvas.height]).toEqual([1920, 1080]);
    // Fitted by globals.css next to the video, Fill included, not inline.
    expect(canvas.hasAttribute('data-frame-hold')).toBe(true);
    expect(canvas.style.objectFit).toBe('');
    expect(canvas.style.position).toBe('absolute');
    expect(canvas.style.pointerEvents).toBe('none');
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    hold?.release();
    expect(el.nextElementSibling).toBeNull();
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it('keeps the whole frame at no more pixels than the box shows', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context());
    vi.stubGlobal('devicePixelRatio', 2);
    // A 1080p stream in the 256×144 mini player at 2x: enough to cover the box.
    const mini = video({ width: 1920, height: 1080, box: [256, 144] });
    holdFrame(mini)?.release();
    expect(frameDraw()).toEqual([mini, 0, 0, 512, 288]);
    vi.unstubAllGlobals();
  });

  it('keeps the whole frame, in the source shape, under the pixel budget for 4K in a portrait box, Fill or not', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context());
    vi.stubGlobal('devicePixelRatio', 3);
    // The re-test's case: 4K in a 402×714 pt box at 3x was a 3808×2142 canvas, then a 1206×2142 crop.
    for (const fill of [false, true]) {
      const el = video({ width: 3840, height: 2160, box: [402, 714] });
      if (fill) el.setAttribute('data-fill', '');
      holdFrame(el);
      const canvas = el.nextElementSibling as HTMLCanvasElement;
      expect([canvas.width, canvas.height], `fill ${fill}`).toEqual([1920, 1080]);
      expect(canvas.width * canvas.height).toBeLessThanOrEqual(HOLD_PIXEL_BUDGET);
      expect(canvas.width / canvas.height).toBeCloseTo(3840 / 2160, 2); // the whole frame: cover and contain both stay right
      expect(frameDraw()).toEqual([el, 0, 0, 1920, 1080]);
      el.parentElement?.remove();
    }
    vi.unstubAllGlobals();
  });

  it('holds a frame with picture in any one of its sixteen sample points', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context());
    expect(holdFrame(video())).not.toBeNull();
    expect(getImageData).toHaveBeenCalledTimes(1);
  });

  it('keeps the hold when the frame cannot be read back', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage, getImageData: () => { throw new DOMException('tainted', 'SecurityError'); } } as unknown as CanvasRenderingContext2D);
    expect(holdFrame(video())).not.toBeNull();
  });

  it('holds nothing for an all-black frame, which the element already shows', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context());
    black = true;
    const el = video();
    expect(holdFrame(el)).toBeNull();
    expect(el.nextElementSibling).toBeNull();
    expect(getImageData).toHaveBeenCalledTimes(1); // one 4×4 readback, not one per point
    expect(getImageData).toHaveBeenCalledWith(0, 0, 4, 4);
  });

  it('holds nothing without a frame, or without a 2D canvas', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context());
    expect(holdFrame(video({ readyState: 1 }))).toBeNull();
    expect(holdFrame(video({ width: 0, height: 0 }))).toBeNull(); // audio only
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(holdFrame(video())).toBeNull();
    expect(document.querySelector('canvas')).toBeNull();
  });
});

describe('whenFramePresented', () => {
  it('waits for a presented frame where the browser reports them', () => {
    const el = video();
    let presented: (() => void) | undefined;
    const cancelVideoFrameCallback = vi.fn();
    Object.assign(el, {
      requestVideoFrameCallback: (callback: () => void) => { presented = callback; return 7; },
      cancelVideoFrameCallback,
    });
    const onFrame = vi.fn();
    const cancel = whenFramePresented(el, onFrame);
    el.dispatchEvent(new Event('loadeddata'));
    expect(onFrame).not.toHaveBeenCalled();
    presented?.();
    expect(onFrame).toHaveBeenCalledTimes(1);
    cancel();
    expect(cancelVideoFrameCallback).toHaveBeenCalledWith(7);
  });

  it('takes the first loaded frame elsewhere, and can be cancelled', () => {
    const el = video();
    const onFrame = vi.fn();
    whenFramePresented(el, onFrame);
    el.dispatchEvent(new Event('loadeddata'));
    el.dispatchEvent(new Event('loadeddata'));
    expect(onFrame).toHaveBeenCalledTimes(1);

    const later = vi.fn();
    whenFramePresented(el, later)();
    el.dispatchEvent(new Event('loadeddata'));
    expect(later).not.toHaveBeenCalled();
  });

  /** An element of Safari's own HLS: requestVideoFrameCallback exists and never fires. */
  function silentFrames() {
    const el = video();
    let time = 30;
    let paused = true;
    Object.defineProperty(el, 'currentTime', { get: () => time, set: (value: number) => { time = value; } });
    Object.defineProperty(el, 'paused', { get: () => paused });
    Object.assign(el, { requestVideoFrameCallback: vi.fn(() => 1), cancelVideoFrameCallback: vi.fn() });
    return { el, play: () => { paused = false; el.dispatchEvent(new Event('playing')); }, advance: (to: number) => { time = to; el.dispatchEvent(new Event('timeupdate')); } };
  }

  it('stays while paused when presented frames never come, and goes once playback moves', () => {
    const { el, play, advance } = silentFrames();
    const onFrame = vi.fn();
    whenFramePresented(el, onFrame);
    el.dispatchEvent(new Event('loadeddata'));
    advance(30); // a paused timeupdate (the seek into place)
    expect(onFrame).not.toHaveBeenCalled();
    play();
    advance(30); // not moved yet
    expect(onFrame).not.toHaveBeenCalled();
    advance(30.25);
    expect(onFrame).toHaveBeenCalledTimes(1);
    advance(31);
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it('goes a moment after playing even if the time never seems to move', () => {
    vi.useFakeTimers();
    const { el, play } = silentFrames();
    const onFrame = vi.fn();
    whenFramePresented(el, onFrame);
    play();
    vi.advanceTimersByTime(PLAYING_RELEASE_MS - 1);
    expect(onFrame).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(PLAYING_RELEASE_MS).toBeLessThanOrEqual(1_500);
  });

  describe("on Safari's own HLS (afterPlay)", () => {
    /** An element whose presented frames are reported, as WebKit may while paused and black. */
    function reportedFrames() {
      const { el, play, advance } = silentFrames();
      let presented: (() => void) | undefined;
      const requestVideoFrameCallback = vi.fn((callback: () => void) => { presented = callback; return 1; });
      Object.assign(el, { requestVideoFrameCallback });
      const present = () => { const callback = presented; presented = undefined; callback?.(); };
      return { el, play, advance, present, requestVideoFrameCallback };
    }

    it('ignores a frame or a load reported while paused, and goes on the first frame after Play', () => {
      const { el, play, present, requestVideoFrameCallback } = reportedFrames();
      const onFrame = vi.fn();
      whenFramePresented(el, onFrame, { afterPlay: true });
      present();
      el.dispatchEvent(new Event('loadeddata'));
      present();
      expect(onFrame).not.toHaveBeenCalled();
      // Still waiting on the next one.
      expect(requestVideoFrameCallback).toHaveBeenCalledTimes(3);
      play();
      present();
      expect(onFrame).toHaveBeenCalledTimes(1);
    });

    it('ignores a paused load where frames are not reported, and goes once playback moves', () => {
      const { el, play, advance } = silentFrames();
      Object.assign(el, { requestVideoFrameCallback: undefined });
      const onFrame = vi.fn();
      whenFramePresented(el, onFrame, { afterPlay: true });
      el.dispatchEvent(new Event('loadeddata'));
      expect(onFrame).not.toHaveBeenCalled();
      play();
      advance(30.25);
      expect(onFrame).toHaveBeenCalledTimes(1);
    });

    it('takes a frame at once while playing', () => {
      const { el, play, present } = reportedFrames();
      play();
      const onFrame = vi.fn();
      whenFramePresented(el, onFrame, { afterPlay: true });
      present();
      expect(onFrame).toHaveBeenCalledTimes(1);
    });
  });

  it('stops listening once cancelled, timer included', () => {
    vi.useFakeTimers();
    const { el, play, advance } = silentFrames();
    const onFrame = vi.fn();
    const cancel = whenFramePresented(el, onFrame);
    play();
    cancel();
    advance(40);
    vi.advanceTimersByTime(PLAYING_RELEASE_MS * 2);
    expect(onFrame).not.toHaveBeenCalled();
  });
});
