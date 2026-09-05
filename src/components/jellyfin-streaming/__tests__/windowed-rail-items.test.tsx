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

async function mount() {
  await act(async () => root.render(
    <div ref={viewportRef}>
      <WindowedRailItems viewportRef={viewportRef} className="aspect-2/3 w-[112px]">
        {Array.from({ length: 20 }, (_, index) => <button key={index}>Title {index}</button>)}
      </WindowedRailItems>
    </div>,
  ));
  const slots = Array.from(container.querySelectorAll('[data-rail-slot]'));
  const [horizontal, vertical] = Observer.instances;
  return { slots, horizontal, vertical };
}

describe('windowed rail items', () => {
  it('reserves all tile geometry and mounts only the nearby horizontal window', async () => {
    const { slots, horizontal, vertical } = await mount();
    expect(slots).toHaveLength(20);
    expect(slots.every((slot) => slot.classList.contains('aspect-2/3'))).toBe(true);
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(horizontal.observe).not.toHaveBeenCalled();
    await vertical.emit([{ target: viewportRef.current!, isIntersecting: true }]);
    expect(horizontal.options.root).toBe(viewportRef.current);
    expect(horizontal.options.rootMargin).toBe('0px 300px');
    expect(horizontal.observe).toHaveBeenCalledTimes(20);
    await horizontal.emit(slots.slice(0, 5).map((target) => ({ target, isIntersecting: true })));
    expect(container.querySelectorAll('button')).toHaveLength(5);
    expect(slots[0].hasAttribute('aria-hidden')).toBe(false);
    expect(slots[5].getAttribute('aria-hidden')).toBe('true');
    await horizontal.emit([
      ...slots.slice(0, 5).map((target) => ({ target, isIntersecting: false })),
      ...slots.slice(15).map((target) => ({ target, isIntersecting: true })),
    ]);
    expect(Array.from(container.querySelectorAll('button')).map((button) => button.textContent))
      .toEqual(['Title 15', 'Title 16', 'Title 17', 'Title 18', 'Title 19']);
    expect(container.querySelectorAll('[data-rail-slot]')).toHaveLength(20);
  });

  it('preserves keyboard focus while removing other cards from distant rows', async () => {
    const { slots, horizontal, vertical } = await mount();
    await vertical.emit([{ target: viewportRef.current!, isIntersecting: true }]);
    await horizontal.emit(slots.slice(0, 2).map((target) => ({ target, isIntersecting: true })));
    const button = slots[0].querySelector('button')!;
    button.focus();
    await vertical.emit([{ target: viewportRef.current!, isIntersecting: false }]);
    expect(document.activeElement).toBe(button);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    // A queued horizontal delivery after a row leaves view must not remount it.
    await horizontal.emit([{ target: slots[1], isIntersecting: true }]);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(horizontal.disconnect).toHaveBeenCalled();
  });
});
