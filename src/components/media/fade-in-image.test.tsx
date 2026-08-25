// @vitest-environment jsdom

import type { ImgHTMLAttributes } from 'react';
import { act, forwardRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: forwardRef<HTMLImageElement, ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    priority?: boolean;
    unoptimized?: boolean;
  }>(function MockImage({ fill, priority, unoptimized, alt, ...props }, ref) {
    void fill;
    void priority;
    void unoptimized;
    // eslint-disable-next-line @next/next/no-img-element
    return <img ref={ref} alt={alt ?? ''} {...props} />;
  }),
}));

import { FadeInImage } from '@/components/media/fade-in-image';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function currentImage(container: HTMLElement): HTMLImageElement {
  const image = container.querySelector('img');
  if (!image) throw new Error('Expected image element');
  return image;
}

describe('FadeInImage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps a visible loading treatment and retries the identical URL before succeeding', () => {
    act(() => {
      root.render(<FadeInImage src="/api/image?src=poster" alt="Poster" fill />);
    });
    expect(container.querySelector('[data-image-loading="true"]')).not.toBeNull();

    const first = currentImage(container);
    act(() => first.dispatchEvent(new Event('error')));
    expect(currentImage(container)).toBe(first);

    act(() => vi.advanceTimersByTime(750));
    const second = currentImage(container);
    expect(second).not.toBe(first);
    expect(second.getAttribute('src')).toBe(first.getAttribute('src'));

    act(() => second.dispatchEvent(new Event('load')));
    expect(currentImage(container).className).toContain('opacity-100');
    expect(container.querySelector('[data-image-loading="true"]')).toBeNull();
  });

  it('calls an external fallback once only after all three retries fail', () => {
    const onError = vi.fn();
    act(() => {
      root.render(<FadeInImage src="/poster.jpg" alt="Poster" fill onError={onError} />);
    });

    for (const delay of [750, 2_000, 5_000]) {
      act(() => currentImage(container).dispatchEvent(new Event('error')));
      expect(onError).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(delay));
    }
    act(() => currentImage(container).dispatchEvent(new Event('error')));

    expect(onError).toHaveBeenCalledOnce();
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders its built-in fallback when no consumer fallback is supplied', () => {
    act(() => {
      root.render(<FadeInImage src="/broken.jpg" alt="Broken poster" fill />);
    });

    for (const delay of [750, 2_000, 5_000]) {
      act(() => currentImage(container).dispatchEvent(new Event('error')));
      act(() => vi.advanceTimersByTime(delay));
    }
    act(() => currentImage(container).dispatchEvent(new Event('error')));

    expect(container.querySelector('[data-image-fallback="true"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Broken poster');
  });

  it('pauses a retry while offline and resumes on the next online event', () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    act(() => {
      root.render(<FadeInImage src="/offline.jpg" alt="Poster" fill />);
    });
    const first = currentImage(container);
    act(() => first.dispatchEvent(new Event('error')));
    act(() => vi.advanceTimersByTime(10_000));
    expect(currentImage(container)).toBe(first);

    act(() => window.dispatchEvent(new Event('online')));
    expect(currentImage(container)).not.toBe(first);
  });

  it('resets retry state for a changed source and clears timers on unmount', () => {
    act(() => {
      root.render(<FadeInImage src="/first.jpg" alt="First" fill />);
    });
    act(() => currentImage(container).dispatchEvent(new Event('error')));
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      root.render(<FadeInImage src="/second.jpg" alt="Second" fill />);
    });
    expect(currentImage(container).getAttribute('src')).toBe('/second.jpg');
    expect(vi.getTimerCount()).toBe(0);

    act(() => currentImage(container).dispatchEvent(new Event('error')));
    expect(vi.getTimerCount()).toBe(1);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container);
  });

  it('does not treat a completed broken image as loaded', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0);
    act(() => {
      root.render(<FadeInImage src="/complete-but-broken.jpg" alt="Poster" fill />);
    });

    const image = currentImage(container);
    expect(image.complete).toBe(true);
    expect(image.naturalWidth).toBe(0);
    expect(image.className).toContain('opacity-0');
    expect(container.querySelector('[data-image-loading="true"]')).not.toBeNull();
  });
});
