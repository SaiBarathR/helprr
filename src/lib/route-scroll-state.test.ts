// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyRouteScroll,
  captureRouteScroll,
  clearRouteScrollStateForTests,
  flushRouteScrollState,
  readRouteScrollState,
  routeScrollKey,
  writeRouteScrollState,
} from './route-scroll-state';

function metric(element: Element, name: string, value: number) {
  Object.defineProperty(element, name, { configurable: true, value });
}

beforeEach(() => {
  sessionStorage.clear();
  clearRouteScrollStateForTests();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('route scroll state', () => {
  it('captures inline widget and Radix scrollports with stable widget identities', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-widget-id="watchlist"><div style="overflow-x: auto"></div></div><div data-widget-id="recent"><div data-radix-scroll-area-viewport></div></div>';
    document.body.append(root);
    const first = root.children[0].firstElementChild as HTMLElement;
    const second = root.children[1].firstElementChild as HTMLElement;
    for (const element of [first, second]) {
      metric(element, 'scrollWidth', 1000);
      metric(element, 'clientWidth', 200);
    }
    first.scrollLeft = 320;
    second.scrollLeft = 450;
    const saved = captureRouteScroll(root);
    expect(Object.values(saved.elements).map((point) => point.left)).toEqual([320, 450]);
    root.prepend(root.children[1]);
    first.scrollLeft = 0;
    second.scrollLeft = 0;
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    applyRouteScroll(root, saved);
    expect(first.scrollLeft).toBe(320);
    expect(second.scrollLeft).toBe(450);
  });

  it('isolates paths and canonicalized queries, including instance selection', () => {
    expect(routeScrollKey({ pathname: '/series/1', search: '?tab=files&instance=b' } as Location))
      .toBe('/series/1?instance=b&tab=files');
    expect(routeScrollKey({ pathname: '/series/1', search: '?instance=a&tab=files' } as Location))
      .not.toBe('/series/1?instance=b&tab=files');
  });

  it('persists document and nested horizontal and vertical positions', () => {
    writeRouteScrollState('/discover', {
      document: { top: 480, left: 0 },
      elements: { 'named:trending': { top: 0, left: 720 }, 'named:detail': { top: 240, left: 0 } },
    });
    flushRouteScrollState('/discover');
    clearRouteScrollStateForTests();
    expect(readRouteScrollState('/discover')).toMatchObject({
      document: { top: 480, left: 0 },
      elements: { 'named:trending': { top: 0, left: 720 }, 'named:detail': { top: 240, left: 0 } },
    });
  });

  it('captures named and automatic scroll containers inside the route only', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-scroll-restoration-key="rail"></div><div class="overflow-y-auto"></div>';
    document.body.append(root);
    const [rail, pane] = [...root.children] as HTMLElement[];
    rail.scrollLeft = 310;
    pane.scrollTop = 125;
    metric(pane, 'scrollHeight', 500);
    metric(pane, 'clientHeight', 100);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(900);
    expect(captureRouteScroll(root)).toEqual({
      document: { top: 900, left: 0 },
      elements: { 'named:rail': { top: 0, left: 310 }, 'path:div:1': { top: 125, left: 0 } },
    });
  });

  it('preserves fractional offsets at an integer-rounded native scroll boundary', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-scroll-restoration-key="panel"></div>';
    const panel = root.firstElementChild as HTMLElement;
    metric(panel, 'scrollHeight', 399);
    metric(panel, 'clientHeight', 130);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const scroll = vi.fn();
    Object.defineProperty(panel, 'scrollTo', { value: scroll });
    expect(applyRouteScroll(root, { document: { top: 0, left: 0 }, elements: { 'named:panel': { top: 269.5, left: 0 } } })).toBe(true);
    expect(scroll).toHaveBeenCalledWith({ top: 269.5, left: 0, behavior: 'instant' });
  });

  it('retries while slow layout cannot reach the saved position, then restores it', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-scroll-restoration-key="rail"></div>';
    document.body.append(root);
    const rail = root.firstElementChild as HTMLElement;
    metric(document.documentElement, 'scrollHeight', 400);
    metric(rail, 'scrollWidth', 300);
    metric(rail, 'clientWidth', 100);
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const elementScroll = vi.fn();
    Object.defineProperty(rail, 'scrollTo', { configurable: true, value: elementScroll });
    const state = { document: { top: 700, left: 0 }, elements: { 'named:rail': { top: 0, left: 500 } } };
    expect(applyRouteScroll(root, state)).toBe(false);
    expect(windowScroll).toHaveBeenLastCalledWith({ top: 700, left: 0, behavior: 'instant' });
    expect(elementScroll).toHaveBeenLastCalledWith({ top: 0, left: 500, behavior: 'instant' });
    metric(document.documentElement, 'scrollHeight', 1500);
    metric(rail, 'scrollWidth', 800);
    expect(applyRouteScroll(root, state)).toBe(true);
    expect(windowScroll).toHaveBeenLastCalledWith({ top: 700, left: 0, behavior: 'instant' });
    expect(elementScroll).toHaveBeenLastCalledWith({ top: 0, left: 500, behavior: 'instant' });
  });
});
