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
