// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdFrame, whenFramePresented } from '../frame-hold';

function video({ readyState = 4, width = 1920, height = 1080 } = {}) {
  const host = document.createElement('div');
  const el = document.createElement('video');
  Object.defineProperty(el, 'readyState', { value: readyState });
  Object.defineProperty(el, 'videoWidth', { value: width });
  Object.defineProperty(el, 'videoHeight', { value: height });
  el.style.objectFit = 'cover';
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
  it('draws the frame on screen into a canvas over the element, fitted as it is, until released', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const el = video();
    const hold = holdFrame(el);
    const canvas = el.nextElementSibling as HTMLCanvasElement;
    expect(canvas.tagName).toBe('CANVAS');
    expect(drawImage).toHaveBeenCalledWith(el, 0, 0, 1920, 1080);
    expect([canvas.width, canvas.height]).toEqual([1920, 1080]);
    expect(canvas.style.objectFit).toBe('cover');
    expect(canvas.style.position).toBe('absolute');
    expect(canvas.style.pointerEvents).toBe('none');
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    hold?.release();
    expect(el.nextElementSibling).toBeNull();
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
