// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from './drawer';
import { Dialog, DialogContent, DialogTitle } from './dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
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
});
