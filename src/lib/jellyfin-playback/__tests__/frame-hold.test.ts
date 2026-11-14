// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdFrame, whenFramePresented } from '../frame-hold';

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
afterEach(() => {
  vi.restoreAllMocks();
  drawImage.mockReset();
  document.body.innerHTML = '';
});

describe('holdFrame', () => {
  it('draws the frame on screen into a canvas over the element, and frees it on release', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
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

  it('keeps no more pixels than the box shows on screen', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal('devicePixelRatio', 2);
    const el = video({ width: 3840, height: 2160, box: [390, 844] }); // 4K on a portrait phone
    holdFrame(el)?.release();
    // Letterboxed: 390 px wide at 2x.
    expect(drawImage).toHaveBeenLastCalledWith(el, 0, 0, 780, 439);
    // Cropped by Fill: 844 px tall at 2x.
    el.setAttribute('data-fill', '');
    holdFrame(el);
    expect(drawImage).toHaveBeenLastCalledWith(el, 0, 0, 3001, 1688);
    vi.unstubAllGlobals();
  });

  it('holds nothing without a frame, or without a 2D canvas', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
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
});
