// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from './drawer';
import { Dialog, DialogContent, DialogTitle } from './dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { QuickContextMenu } from './quick-context-menu';
import { resetOverlayHistoryForTests } from '@/lib/overlay-history';

// jsdom has no pointer capture, which the drawer asks for on a press inside it.
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

const back = () => act(async () => {
  window.history.back();
  await new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
  // Overlays close once every popstate listener has seen it.
  await new Promise((resolve) => setTimeout(resolve, 5));
});

describe('the shared overlay roots and the system Back', () => {
  beforeEach(() => {
    resetOverlayHistoryForTests();
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    window.history.pushState({ __NA: true }, '', '/movies');
  });

  it('closes a drawer that holds its own open state', async () => {
    render(
      <Drawer>
        <DrawerTrigger>More</DrawerTrigger>
        <DrawerContent>
          <DrawerTitle>More</DrawerTitle>
        </DrawerContent>
      </Drawer>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await back();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/movies');
  });

  it('closes a controlled dialog through its onOpenChange', async () => {
    const onOpenChange = vi.fn();
    function Page() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); setOpen(next); }}>
          <DialogContent>
            <DialogTitle>Change password</DialogTitle>
          </DialogContent>
        </Dialog>
      );
    }
    render(<Page />);
    await waitFor(() => expect((window.history.state as Record<string, unknown>).__helprrOverlay).toBeDefined());
    await back();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes an open select list and stays on the page', async () => {
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    Element.prototype.scrollIntoView ??= () => {};
    const onOpenChange = vi.fn();
    function Page() {
      const [open, setOpen] = useState(true);
      return (
        <Select open={open} onOpenChange={(next) => { onOpenChange(next); setOpen(next); }} defaultValue="in">
          <SelectTrigger aria-label="Region"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="in">India</SelectItem>
            <SelectItem value="gb">United Kingdom</SelectItem>
          </SelectContent>
        </Select>
      );
    }
    render(<Page />);
    expect(screen.getByRole('listbox')).toBeTruthy();
    await waitFor(() => expect((window.history.state as Record<string, unknown>).__helprrOverlay).toBeDefined());
    await back();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(window.location.pathname).toBe('/movies');
  });

  it('closes a ⋯ menu and stays on the page; the next Back leaves', async () => {
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    const before = window.history.length;
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Options</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Refresh</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Options' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    await waitFor(() => expect(window.history.length).toBe(before + 1));
    await back();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(window.location.pathname).toBe('/movies');
    expect((window.history.state as Record<string, unknown> | null)?.__helprrOverlay).toBeUndefined();
  });

  it('takes a ⋯ menu entry back off when an item closes it', async () => {
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    const picked = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Options</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={picked}>Refresh</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Options' }));
    await waitFor(() => expect((window.history.state as Record<string, unknown>).__helprrOverlay).toBeDefined());
    const tookOff = new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Refresh' }));
    await act(() => tookOff);
    expect(picked).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    // The next Back leaves the page in one step: no dead entry is left on top.
    expect((window.history.state as Record<string, unknown> | null)?.__helprrOverlay).toBeUndefined();
  });

  it('closes a popover and stays on the page', async () => {
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    render(
      <Popover>
        <PopoverTrigger>Pick a day</PopoverTrigger>
        <PopoverContent>Days</PopoverContent>
      </Popover>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pick a day' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await waitFor(() => expect((window.history.state as Record<string, unknown>).__helprrOverlay).toBeDefined());
    await back();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/movies');
  });

  it('closes a long-press menu and stays on the page', async () => {
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    render(
      <QuickContextMenu label="Dune" actions={[
        { id: 'monitor', label: 'Monitor', onSelect: () => {} },
        { id: 'search', label: 'Search', onSelect: () => {} },
      ]}>
        <div>Dune poster</div>
      </QuickContextMenu>,
    );
    fireEvent.contextMenu(screen.getByText('Dune poster'));
    expect(screen.getByRole('menu', { name: 'Dune' })).toBeTruthy();
    await waitFor(() => expect((window.history.state as Record<string, unknown>).__helprrOverlay).toBeDefined());
    await back();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(window.location.pathname).toBe('/movies');
  });
});
