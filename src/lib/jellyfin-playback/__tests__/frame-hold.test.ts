// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdFrame, PLAYING_RELEASE_MS, whenFramePresented } from '../frame-hold';

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
const getImageData = vi.fn(() => ({ data: black ? [0, 0, 0, 255] : [120, 80, 40, 255] }));
const context = () => ({ drawImage, getImageData }) as unknown as CanvasRenderingContext2D;
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
    expect(drawImage).toHaveBeenCalledWith(el, 0, 0, 1920, 1080, 0, 0, 1920, 1080);
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

  it('keeps no more pixels than the box shows on screen, letterboxed or filled', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context());
    vi.stubGlobal('devicePixelRatio', 2);
    const el = video({ width: 3840, height: 2160, box: [390, 844] }); // 4K on a portrait phone
    holdFrame(el)?.release();
    // Letterboxed: the whole frame, 390 px wide at 2x.
    expect(drawImage).toHaveBeenLastCalledWith(el, 0, 0, 3840, 2160, 0, 0, 780, 439);
    vi.unstubAllGlobals();
  });

  it('keeps only the part Fill shows, at the box\'s size, not the cropped-away width', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context());
    vi.stubGlobal('devicePixelRatio', 3);
    // The re-test's case: 4K in a 402×714 pt box at 3x was a 3808×2142 canvas.
    const el = video({ width: 3840, height: 2160, box: [402, 714] });
    el.setAttribute('data-fill', '');
    holdFrame(el);
    const canvas = el.nextElementSibling as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([1206, 2142]); // 402×714 at 3x
    const [, sx, sy, sw, sh] = drawImage.mock.lastCall as number[];
    expect(sy).toBe(0);
    expect(sh).toBe(2160);
    expect(Math.round(sw)).toBe(1216); // the middle 402/714 of the height
    expect(Math.round(sx)).toBe(1312);
    vi.unstubAllGlobals();
  });

  it('holds nothing for an all-black frame, which the element already shows', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context());
    black = true;
    const el = video();
    expect(holdFrame(el)).toBeNull();
    expect(el.nextElementSibling).toBeNull();
    expect(getImageData).toHaveBeenCalledTimes(16);
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
