// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterOverlayHistory, resetOverlayHistoryForTests, useBackClosableOpen } from '../overlay-history';

// The router's own history state, which every entry must keep.
const ROUTER_STATE = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: 'page' } };

function Overlay({ name, open, onOpenChange, children }: {
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: React.ReactNode;
}) {
  const [isOpen, setOpen] = useBackClosableOpen(open, undefined, onOpenChange);
  if (!isOpen) return null;
  return (
    <div role="dialog" aria-label={name}>
      <button onClick={() => setOpen(false)}>Close {name}</button>
      {children}
    </div>
  );
}

function Page({ onNavigate, refuse = false }: { onNavigate?: () => void; refuse?: boolean }) {
  const [sheet, setSheet] = useState(false);
  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <button onClick={() => setSheet(true)}>Open sheet</button>
      <Overlay name="sheet" open={sheet} onOpenChange={(open) => { if (!refuse) setSheet(open); }}>
        <button onClick={() => setPicker(true)}>Open picker</button>
        {/* A ⋯ action: closes the sheet and opens a confirm in one go. */}
        <button onClick={() => { setSheet(false); setConfirm(true); }}>Delete</button>
        {/* A pick that navigates: closes the sheet and leaves. */}
        <button onClick={() => { setSheet(false); afterOverlayHistory(() => onNavigate?.()); }}>Calendar</button>
        <Overlay name="picker" open={picker} onOpenChange={setPicker} />
      </Overlay>
      <Overlay name="confirm" open={confirm} onOpenChange={setConfirm} />
    </>
  );
}

const marker = () => (window.history.state as Record<string, unknown> | null)?.__helprrOverlay;
const back = () => act(async () => {
  window.history.back();
  await new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
});
// Our own traversal settles a tick after its popstate.
const settled = () => waitFor(() => expect(marker()).toBeUndefined());

describe('overlay history', () => {
  let baseLength: number;

  beforeEach(() => {
    resetOverlayHistoryForTests();
    // A fresh last entry, so the forward entries an earlier test left are gone.
    window.history.pushState(ROUTER_STATE, '', '/calendar');
    baseLength = window.history.length;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pushes one entry at the same URL that keeps the router state', async () => {
    render(<Page />);
    await userEvent.click(screen.getByText('Open sheet'));
    expect(window.history.length).toBe(baseLength + 1);
    expect(window.location.pathname).toBe('/calendar');
    expect(window.history.state).toMatchObject(ROUTER_STATE);
    expect(marker()).toEqual(expect.any(Number));
  });

  it('closes the open sheet on Back and stays on the page', async () => {
    render(<Page />);
    await userEvent.click(screen.getByText('Open sheet'));
    await back();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.pathname).toBe('/calendar');
    expect(window.history.state).toEqual(ROUTER_STATE);
  });

  it('takes its entry back off once when closed by its own button', async () => {
    const go = vi.spyOn(window.history, 'go');
    render(<Page />);
    await userEvent.click(screen.getByText('Open sheet'));
    await userEvent.click(screen.getByText('Close sheet'));
    await settled();
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-1);
    expect(window.history.state).toEqual(ROUTER_STATE);
    // Opening it again pushes onto the same place, not past a dead entry.
    await userEvent.click(screen.getByText('Open sheet'));
    expect(window.history.length).toBe(baseLength + 1);
  });

  it('closes nested overlays one per Back', async () => {
    render(<Page />);
    await userEvent.click(screen.getByText('Open sheet'));
    await userEvent.click(screen.getByText('Open picker'));
    expect(window.history.length).toBe(baseLength + 2);
    await back();
    expect(screen.queryByRole('dialog', { name: 'picker' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'sheet' })).toBeTruthy();
    await back();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.history.state).toEqual(ROUTER_STATE);
  });

  it('closes a picker by its own button without closing the sheet under it', async () => {
    render(<Page />);
    await userEvent.click(screen.getByText('Open sheet'));
    await userEvent.click(screen.getByText('Open picker'));
    await userEvent.click(screen.getByText('Close picker'));
    await waitFor(() => expect(window.history.length === baseLength + 2 && marker() !== undefined).toBe(true));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'sheet' })).toBeTruthy());
    // The sheet's own entry is current again: one Back closes it.
    await back();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hands a closing sheet\'s entry to a confirm opened from it', async () => {
    const go = vi.spyOn(window.history, 'go');
    render(<Page />);
    await userEvent.click(screen.getByText('Open sheet'));
    await userEvent.click(screen.getByText('Delete'));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('dialog', { name: 'confirm' })).toBeTruthy();
    expect(go).not.toHaveBeenCalled();
    expect(window.history.length).toBe(baseLength + 1);
    await back();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.history.state).toEqual(ROUTER_STATE);
  });

  it('runs a navigation from inside a sheet only after its entry is off history', async () => {
    let stateWhenNavigating: unknown = 'not yet';
    const onNavigate = vi.fn(() => { stateWhenNavigating = window.history.state; });
    const go = vi.spyOn(window.history, 'go');
    render(<Page onNavigate={onNavigate} />);
    await userEvent.click(screen.getByText('Open sheet'));
    await userEvent.click(screen.getByText('Calendar'));
    expect(onNavigate).not.toHaveBeenCalled();
    await waitFor(() => expect(onNavigate).toHaveBeenCalledTimes(1));
    // On the page's own entry, so the router pushes from there.
    expect(stateWhenNavigating).toEqual(ROUTER_STATE);
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('navigates at once when no overlay is open', () => {
    const navigate = vi.fn();
    afterOverlayHistory(navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('keeps an overlay that refuses to close on Back, ready for the next one', async () => {
    render(<Page refuse />);
    await userEvent.click(screen.getByText('Open sheet'));
    await back();
    expect(screen.getByRole('dialog', { name: 'sheet' })).toBeTruthy();
    await waitFor(() => expect(marker()).toEqual(expect.any(Number)));
    expect(window.history.length).toBe(baseLength + 1);
  });

  it('keeps a URL the page rewrote while the sheet was open', async () => {
    render(<Page />);
    await userEvent.click(screen.getByText('Open sheet'));
    // Activity mirrors a filter into the URL like this; the marker is lost.
    window.history.replaceState(null, '', '/calendar?view=week');
    await userEvent.click(screen.getByText('Close sheet'));
    await waitFor(() => expect(window.location.search).toBe('?view=week'));
    // Back on the page's own entry (the router's patched replaceState copies
    // its __NA and tree onto the rewrite; jsdom has no router).
    expect(window.history.length).toBe(baseLength + 1);
    expect(marker()).toBeUndefined();
  });

  it('leaves history alone when something else pushed over the sheet\'s entry', async () => {
    const go = vi.spyOn(window.history, 'go');
    render(<Page />);
    await userEvent.click(screen.getByText('Open sheet'));
    window.history.pushState(ROUTER_STATE, '', '/settings');
    await userEvent.click(screen.getByText('Close sheet'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(go).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/settings');
  });
});
