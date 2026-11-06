// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPullToRefreshAtTop, startsInScrolledElement, usePullToRefresh } from './use-pull-to-refresh';

vi.mock('@/lib/haptics', () => ({ haptic: () => {} }));

describe('isPullToRefreshAtTop', () => {
  it('allows refresh when the document and nested scroll target are both at the top', () => {
    expect(isPullToRefreshAtTop(0, 0)).toBe(true);
    expect(isPullToRefreshAtTop(undefined, 0)).toBe(true);
  });

  it('blocks refresh when the nested target has scrolled', () => {
    expect(isPullToRefreshAtTop(24, 0)).toBe(false);
  });

  it('blocks refresh when the document has scrolled but the nested target has not', () => {
    expect(isPullToRefreshAtTop(0, 320)).toBe(false);
  });

  it('treats a negative rubber-band offset as the top boundary', () => {
    expect(isPullToRefreshAtTop(-4, -2)).toBe(true);
  });
});

function touch(type: 'touchstart' | 'touchmove' | 'touchend', target: Element, x = 0, y = 0) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] });
  target.dispatchEvent(event);
}

function scrolled(element: Element, top: number) {
  Object.defineProperty(element, 'scrollTop', { configurable: true, value: top });
}

describe('startsInScrolledElement', () => {
  it('finds a scrolled-down ancestor of the touch target', () => {
    document.body.innerHTML = '<div id="list" style="overflow-y: auto"><p><span id="row">row</span></p></div>';
    expect(startsInScrolledElement(document.getElementById('row'))).toBe(false);
    scrolled(document.getElementById('list')!, 120);
    expect(startsInScrolledElement(document.getElementById('row'))).toBe(true);
  });

  it('ignores a stray few-pixel offset and a clipped wrapper moved by focus', () => {
    document.body.innerHTML = '<div id="rail" style="overflow-x: auto"><div id="clip" style="overflow: hidden"><span id="row">row</span></div></div>';
    scrolled(document.getElementById('rail')!, 1);
    scrolled(document.getElementById('clip')!, 80);
    expect(startsInScrolledElement(document.getElementById('row'))).toBe(false);
  });

  it('ignores a target that is not an element', () => {
    expect(startsInScrolledElement(window)).toBe(false);
    expect(startsInScrolledElement(null)).toBe(false);
  });
});

describe('usePullToRefresh gesture', () => {
  let onRefresh: ReturnType<typeof vi.fn<() => void>>;
  let row: HTMLElement;

  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    document.body.innerHTML = '<div id="list" style="overflow-y: auto"><div id="row">row</div></div>';
    row = document.getElementById('row')!;
    onRefresh = vi.fn();
    renderHook(() => usePullToRefresh({ onRefresh }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Raw travel 140px resists to 70px, past the 64px threshold.
  function pull(target: Element, moves: Array<[number, number]>) {
    touch('touchstart', target, 100, 100);
    for (const [x, y] of moves) touch('touchmove', target, x, y);
    touch('touchend', target);
  }

  it('refreshes on a downward pull past the threshold', () => {
    pull(row, [[102, 120], [104, 240]]);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('leaves a mostly sideways start (rail scroll, row swipe) alone', () => {
    pull(row, [[140, 110], [150, 240]]);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('leaves a 45 degree start to the row swipe, which claims ties', () => {
    pull(row, [[107, 107], [110, 240]]);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('leaves a drag inside a scrolled-down inner list alone', () => {
    scrolled(document.getElementById('list')!, 200);
    pull(row, [[102, 120], [104, 240]]);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
