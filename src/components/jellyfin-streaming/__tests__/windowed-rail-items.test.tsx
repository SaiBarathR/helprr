// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowedRailItems } from '@/components/jellyfin-streaming/windowed-rail-items';

class Observer {
  static instances: Observer[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(public callback: IntersectionObserverCallback, public options: IntersectionObserverInit) {
    Observer.instances.push(this);
  }
  async emit(entries: Array<{ target: Element; isIntersecting: boolean }>) {
    await act(async () => this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver));
  }
}

let container: HTMLDivElement;
let root: Root;
const viewportRef = createRef<HTMLDivElement>();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', Observer);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  Observer.instances = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function setMetric(element: Element, key: 'offsetLeft' | 'offsetWidth' | 'clientWidth' | 'scrollLeft', value: number) {
  Object.defineProperty(element, key, {
    configurable: true,
    get: () => value,
  });
}

function setScrollLeft(element: Element, value: number) {
  Object.defineProperty(element, 'scrollLeft', {
    configurable: true,
    get: () => value,
  });
}

function defineSlotMetrics(slots: Element[], width = 112, gap = 8) {
  slots.forEach((slot, index) => {
    setMetric(slot, 'offsetLeft', index * (width + gap));
    setMetric(slot, 'offsetWidth', width);
  });
}

async function mount(count = 50) {
  await act(async () => root.render(
    <div ref={viewportRef}>
      <WindowedRailItems viewportRef={viewportRef} className="aspect-2/3 w-[112px]">
        {Array.from({ length: count }, (_, index) => <button key={index}>Title {index}</button>)}
      </WindowedRailItems>
    </div>,
  ));
  const slots = Array.from(container.querySelectorAll('[data-rail-slot]'));
  defineSlotMetrics(slots);
  setMetric(viewportRef.current!, 'clientWidth', 360);
  setScrollLeft(viewportRef.current!, 0);
  const [vertical] = Observer.instances;
  return { slots, vertical };
}

describe('windowed rail items', () => {
  it('reserves all tile geometry and mounts only the nearby horizontal window', async () => {
    const { slots, vertical } = await mount(50);
    expect(slots).toHaveLength(50);
    expect(slots.every((slot) => slot.classList.contains('aspect-2/3'))).toBe(true);
    expect(container.querySelectorAll('button')).toHaveLength(0);
    await vertical.emit([{ target: viewportRef.current!, isIntersecting: true }]);
    expect(vertical.options.rootMargin).toBe('300px 0px');
    expect(container.querySelectorAll('button')).toHaveLength(6);
    const firstCard = slots[0].firstElementChild;
    expect(viewportRef.current?.dataset.railArrived).toBe('true');
    expect(slots[0].hasAttribute('aria-hidden')).toBe(false);
    expect(slots[7].getAttribute('aria-hidden')).toBe('true');
    setScrollLeft(viewportRef.current!, 1800);
    await act(async () => viewportRef.current!.dispatchEvent(new Event('scroll')));
    expect(Array.from(container.querySelectorAll('button')).map((button) => button.textContent))
      .toEqual(['Title 12', 'Title 13', 'Title 14', 'Title 15', 'Title 16', 'Title 17', 'Title 18', 'Title 19', 'Title 20']);
    expect(container.querySelectorAll('[data-rail-slot]')).toHaveLength(50);
    setScrollLeft(viewportRef.current!, 0);
    await act(async () => viewportRef.current!.dispatchEvent(new Event('scroll')));
    // The animation's nodes and item order survive a complete card remount.
    const returnedSlots = Array.from(container.querySelectorAll('[data-rail-slot]'));
    expect(returnedSlots.every((slot, index) => slot === slots[index])).toBe(true);
    expect(slots[0].firstElementChild).not.toBe(firstCard);
    expect(viewportRef.current?.dataset.railArrived).toBe('true');
  });

  it('keeps a 500-item rail bounded to the viewport and overscan', async () => {
    const { slots, vertical } = await mount(500);
    expect(slots).toHaveLength(500);
    await vertical.emit([{ target: viewportRef.current!, isIntersecting: true }]);
    expect(container.querySelectorAll('button').length).toBeLessThanOrEqual(7);

    setScrollLeft(viewportRef.current!, 30_000);
    await act(async () => viewportRef.current!.dispatchEvent(new Event('scroll')));
    expect(container.querySelectorAll('button').length).toBeLessThanOrEqual(9);
    expect(container.querySelectorAll('[data-rail-slot]')).toHaveLength(500);
  });

  it('preserves keyboard focus while removing other cards from distant rows', async () => {
    const { slots, vertical } = await mount(50);
    await vertical.emit([{ target: viewportRef.current!, isIntersecting: true }]);
    const button = slots[0].querySelector('button')!;
    button.focus();
    await vertical.emit([{ target: viewportRef.current!, isIntersecting: false }]);
    expect(document.activeElement).toBe(button);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    // A queued scroll delivery after a row leaves view must not remount it.
    setScrollLeft(viewportRef.current!, 1800);
    await act(async () => viewportRef.current!.dispatchEvent(new Event('scroll')));
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(vertical.disconnect).not.toHaveBeenCalled();
  });
});
