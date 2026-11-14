// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './data-table';

vi.mock('@/lib/hooks/use-route-view-state', () => ({
  useRouteViewState: <T,>(_key: string, initial: T) => useState(initial),
}));

let containerWidth: number;
let tableWidth: number;
let notifyResize: () => void;
const disconnect = vi.fn();

beforeEach(() => {
  localStorage.clear();
  containerWidth = 1000;
  tableWidth = 1000;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => containerWidth);
  // Model the terminal grip's 6 px overhang independently of the table box.
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => tableWidth + 6);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return { width: tableWidth } as DOMRect;
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notifyResize = callback; }
    observe() {}
    disconnect = disconnect;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function table(stickyHeaderTop?: string, stickyHeader = true) {
  return <DataTable tableId="sticky-test" columns={[
    { id: 'title', label: 'Title', width: 200, cell: (row: string) => row },
  ]} rows={['Alien']} rowKey={String} stickyHeader={stickyHeader} stickyHeaderTop={stickyHeaderTop} />;
}

describe('DataTable sticky header', () => {
  it.each([1280, 820])('ignores the resize grip overhang at viewport width %i', (width) => {
    containerWidth = tableWidth = width;
    render(table());
    expect(screen.getByRole('separator')).toBeTruthy();
    expect(screen.getByRole('columnheader').classList.contains('sticky')).toBe(true);
    expect(screen.getByRole('table').parentElement?.className).toBe('overflow-x-clip');
  });

  it('keeps horizontal scrolling for real column overflow and restores sticky when it fits', () => {
    tableWidth = containerWidth + 2;
    render(table());
    const header = screen.getByRole('columnheader');
    expect(header.classList.contains('sticky')).toBe(false);
    expect(screen.getByRole('table').parentElement?.className).toContain('overflow-x-auto');
    tableWidth = containerWidth;
    act(() => notifyResize());
    expect(header.classList.contains('sticky')).toBe(true);
    containerWidth -= 100;
    act(() => notifyResize());
    expect(header.classList.contains('sticky')).toBe(false);
  });

  it('defaults to the header inset plus --page-toolbar-height, with a 2.75rem fallback', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(containerWidth);
    render(table());
    expect(screen.getByRole('columnheader').style.top).toBe('calc(var(--header-height, 0px) + var(--page-toolbar-height, 2.75rem))');
  });

  it('preserves explicit offsets and the non-sticky opt-out', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(containerWidth);
    const { rerender } = render(table('156px'));
    expect(screen.getByRole('columnheader').style.top).toBe('156px');
    rerender(table('156px', false));
    expect(screen.getByRole('columnheader').classList.contains('sticky')).toBe(false);
    expect(screen.getByRole('columnheader').style.top).toBe('');
  });
});

describe('DataTable column resize', () => {
  const columns = [
    { id: 'title', label: 'Title', width: 200, grow: true, cell: (row: string) => row },
    { id: 'year', label: 'Year', width: 80, cell: () => '1979' },
    { id: 'size', label: 'Size', width: 90, cell: () => '4 GB' },
  ];
  const cols = () => [...document.querySelectorAll('col')] as HTMLTableColElement[];
  const drag = (grip: Element, from: number, to: number) => act(() => {
    grip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: from }));
    grip.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: to }));
    grip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: to }));
  });

  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
  });

  it('paints each sticky header cell over the next, so a grip overhanging the next cell stays grabbable', () => {
    render(<DataTable tableId="resize-test" columns={columns} rows={['Alien']} rowKey={String} stickyHeader />);
    const z = screen.getAllByRole('columnheader').map((th) => Number(th.style.zIndex));
    expect(z[0]).toBeGreaterThan(z[1]);
    expect(z[1]).toBeGreaterThan(z[2]);
    // Still under the sticky page toolbar (z-index 30).
    expect(Math.max(...z)).toBeLessThan(30);
  });

  it('resizes the grow column from its width on screen and keeps it absorbing the leftover space', () => {
    // The grow column shows 500px wide: well over its 200px minimum.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { width: this.tagName === 'TH' ? 500 : tableWidth } as DOMRect;
    });
    render(<DataTable tableId="resize-test" columns={columns} rows={['Alien']} rowKey={String} />);
    drag(screen.getAllByRole('separator')[0], 100, 160);
    // 500 + 60, not 200 + 60; still a minimum (no fixed width handing the
    // leftover to Year and Size).
    expect(cols()[0].style.minWidth).toBe('560px');
    expect(cols()[0].style.width).toBe('');
    expect(cols()[1].style.width).toBe('80px');
    expect(JSON.parse(localStorage.getItem('helprr-table:resize-test') ?? '{}').widths).toEqual({ title: 560 });
  });
});
