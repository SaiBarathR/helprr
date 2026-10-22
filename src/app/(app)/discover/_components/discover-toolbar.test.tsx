// @vitest-environment jsdom

import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRouteScrollStateForTests, routeScrollKey, setFreshArrival, writeRouteScrollState } from '@/lib/route-scroll-state';

vi.mock('@/components/media/search-bar', () => ({ SearchBar: () => null }));

import { DiscoverToolbar } from './discover-toolbar';

const props: ComponentProps<typeof DiscoverToolbar> = {
  searchParamsKey: 'section=upcoming', query: '', handleQueryChange: vi.fn(),
  discoverContentType: 'all', handleSelectContentType: vi.fn(), handleOpenFilters: vi.fn(),
  activeAdvancedFilterCount: 0, discoverSort: 'upcoming', handleSelectSort: vi.fn(),
  rateLimitInfo: null, rateLimitCountdown: null,
};
let chipBounds: { left: number; right: number };

beforeEach(() => {
  sessionStorage.clear();
  clearRouteScrollStateForTests();
  window.history.replaceState(null, '', '/discover?section=upcoming');
  chipBounds = { left: 430, right: 520 };
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const bounds = this.dataset.scrollRestorationKey === 'discover-sort'
      ? { left: 10, right: 310 } : this.tagName === 'BUTTON' ? chipBounds : { left: 0, right: 0 };
    return { ...bounds, top: 100, bottom: 130, width: bounds.right - bounds.left, height: 30, x: bounds.left, y: 100, toJSON: () => ({}) };
  });
});

afterEach(() => {
  expect(window.scrollTo).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  clearRouteScrollStateForTests();
});

function row() {
  return screen.getByRole('button', { name: 'Upcoming' }).parentElement!;
}

function saveOffset(left: number) {
  writeRouteScrollState(routeScrollKey(window.location), {
    document: { top: 600, left: 0 }, elements: { 'named:discover-sort': { top: 0, left } },
  });
}

describe('Discover selected sort visibility', () => {
  it('reveals an offscreen Upcoming chip on a direct arrival using only horizontal row scroll', () => {
    render(<DiscoverToolbar {...props} />);
    expect(row().scrollLeft).toBe(210);
  });

  it('keeps an already visible chip still', () => {
    chipBounds = { left: 100, right: 190 };
    render(<DiscoverToolbar {...props} />);
    expect(row().scrollLeft).toBe(0);
  });

  it('reveals a chip clipped at the left edge', () => {
    chipBounds = { left: -40, right: 50 };
    const view = render(<DiscoverToolbar {...props} discoverSort="popular" />);
    row().scrollLeft = 120;
    view.rerender(<DiscoverToolbar {...props} />);
    expect(row().scrollLeft).toBe(70);
  });

  it('reveals a new selection after link-driven navigation in the same toolbar', () => {
    chipBounds = { left: 10, right: 100 };
    const view = render(<DiscoverToolbar {...props} searchParamsKey="" discoverSort="trending" />);
    chipBounds = { left: 430, right: 520 };
    setFreshArrival(routeScrollKey(window.location));
    view.rerender(<DiscoverToolbar {...props} />);
    expect(row().scrollLeft).toBe(210);
  });

  it.each([0, 150])('leaves a saved Back/Forward or reload offset of %s to restoration, then reveals a later sort change', (left) => {
    saveOffset(left);
    const view = render(<DiscoverToolbar {...props} discoverSort="trending" />);
    expect(row().scrollLeft).toBe(0);
    row().scrollLeft = left;
    // Picking another sort on the same visit (the filter sheet, Discover home)
    // brings the new chip into view.
    view.rerender(<DiscoverToolbar {...props} />);
    expect(row().scrollLeft).toBe(left + 210);
  });

  it('keeps the page padding between a revealed chip and the screen edge', () => {
    const view = render(<DiscoverToolbar {...props} discoverSort="trending" />);
    row().style.scrollPaddingRight = '16px';
    row().scrollLeft = 0;
    view.rerender(<DiscoverToolbar {...props} />);
    expect(row().scrollLeft).toBe(226);
  });

  it('reveals the selection on a fresh link even when an older visit has a saved offset', () => {
    saveOffset(0);
    setFreshArrival(routeScrollKey(window.location));
    render(<DiscoverToolbar {...props} />);
    expect(row().scrollLeft).toBe(210);
  });
});
