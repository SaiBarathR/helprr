// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { afterOverlayHistory, isOverlayPopState, resetOverlayHistoryForTests, useBackClosableOpen } from '../overlay-history';

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
        {/* A ⋯ menu item: Radix commits its onSelect (the confirm) at once, and closes the menu after. */}
        <button onClick={() => { flushSync(() => setConfirm(true)); setSheet(false); }}>Delete from menu</button>
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
  // Overlays close once every popstate listener has seen it.
  await new Promise((resolve) => setTimeout(resolve, 5));
});
// Our own traversal settles a tick after its popstate.
const settled = () => waitFor(() => expect(marker()).toBeUndefined());


// A stand-in for the Navigation API: entries with stable keys (a
// replaceState keeps the key), the index, and a navigate event before each
// traversal. jsdom has none.
function installNavigation() {
  const list = [{ key: 'k0', url: window.location.href }];
  let index = 0;
  let next = 1;
  const navigation = Object.defineProperties(new EventTarget(), {
    currentEntry: { get: () => ({ ...list[index], index }) },
    canGoBack: { get: () => index > 0 },
    canGoForward: { get: () => index < list.length - 1 },
    entries: { value: () => list.map((entry, i) => ({ ...entry, index: i })) },
  });
  const { pushState, replaceState, go } = window.history;
  window.history.pushState = function (...args: Parameters<History['pushState']>) {
    pushState.apply(this, args);
    list.splice(index + 1, Infinity, { key: `k${next++}`, url: window.location.href });
    index += 1;
  };
  window.history.replaceState = function (...args: Parameters<History['replaceState']>) {
    replaceState.apply(this, args);
    list[index] = { ...list[index], url: window.location.href };
  };
  window.history.go = function (delta = 0) {
    const target = index + delta;
    if (!delta || target < 0 || target >= list.length) return;
    navigation.dispatchEvent(Object.assign(new Event('navigate'), { navigationType: 'traverse', destination: { index: target } }));
    index = target;
    go.call(this, delta);
  };
  window.history.back = () => window.history.go(-1);
  window.history.forward = () => window.history.go(1);
  Object.defineProperty(window, 'navigation', { configurable: true, value: navigation });
  onTestFinished(() => {
    Object.assign(window.history, { pushState, replaceState, go });
    delete (window.history as Partial<History>).back;
    delete (window.history as Partial<History>).forward;
    delete (window as { navigation?: unknown }).navigation;
  });
  return { key: () => list[index].key };
}

const forward = () => act(async () => {
  window.history.forward();
  // The landing, our step past it, and the settle after that.
  await new Promise((resolve) => setTimeout(resolve, 60));
});

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
    vi.unstubAllGlobals();
  });

  it('pushes one entry at the same URL that keeps the router state', async () => {
    render(<Page />);
    await userEvent.click(screen.getByText('Open sheet'));
    expect(window.history.length).toBe(baseLength + 1);
    expect(window.location.pathname).toBe('/calendar');
    expect(window.history.state).toMatchObject(ROUTER_STATE);
    expect(marker()).toEqual(expect.any(String));
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

  it('hands the entry over when the confirm commits before the menu closes', async () => {
    const go = vi.spyOn(window.history, 'go');
    render(<Page />);
    await userEvent.click(screen.getByText('Open sheet'));
    await userEvent.click(screen.getByText('Delete from menu'));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('dialog', { name: 'confirm' })).toBeTruthy();
    expect(go).not.toHaveBeenCalled();
    expect(window.history.length).toBe(baseLength + 1);
    await back();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.history.state).toEqual(ROUTER_STATE);
    expect(go).not.toHaveBeenCalled();
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
    await waitFor(() => expect(marker()).toEqual(expect.any(String)));
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

  // The player collapses on Back; Play in the Watch modal closes the modal
  // (taking its entry off) and expands the player in the same click.
  it('marks its own traversals and a Back that only closed a sheet, not a plain Back', async () => {
    const seen: boolean[] = [];
    const listener = (event: PopStateEvent) => seen.push(isOverlayPopState(event));
    window.addEventListener('popstate', listener);
    try {
      render(<Page />);
      await userEvent.click(screen.getByText('Open sheet'));
      await userEvent.click(screen.getByText('Close sheet'));
      await settled();
      await userEvent.click(screen.getByText('Open sheet'));
      await back();
      window.history.pushState(ROUTER_STATE, '', '/settings');
      await back();
      expect(seen).toEqual([true, true, false]);
    } finally {
      window.removeEventListener('popstate', listener);
    }
  });

  it('calls onOpenChange(false) once when the overlay\'s own close navigates', async () => {
    const onOpenChange = vi.fn();
    const navigate = vi.fn();
    function Closer() {
      const [open, setOpen] = useState(true);
      return (
        <Overlay
          name="sheet"
          open={open}
          // Prowlarr's sheet: closing it rewrites the URL.
          onOpenChange={(next) => { onOpenChange(next); setOpen(next); if (!next) afterOverlayHistory(navigate); }}
        />
      );
    }
    render(<Closer />);
    await waitFor(() => expect(marker()).toEqual(expect.any(String)));
    await userEvent.click(screen.getByText('Close sheet'));
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(marker()).toBeUndefined();
  });

  it('keeps entry state the page wrote while the sheet was open', async () => {
    render(<Page />);
    await userEvent.click(screen.getByText('Open sheet'));
    // Discover's Apply saves its browse mode on the entry, then closes the sheet.
    window.history.replaceState({ ...window.history.state, 'helprr:discoverManualBrowse': true }, '');
    await userEvent.click(screen.getByText('Close sheet'));
    await settled();
    expect(window.history.state).toMatchObject({ 'helprr:discoverManualBrowse': true });
  });

  it('steps back past a closed sheet\'s entry that Forward lands on', async () => {
    render(<Page />);
    await userEvent.click(screen.getByText('Open sheet'));
    await back();
    expect(screen.queryByRole('dialog')).toBeNull();
    const go = vi.spyOn(window.history, 'go');
    await act(async () => {
      window.history.forward();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(go).toHaveBeenCalledWith(-1);
    await waitFor(() => expect(marker()).toBeUndefined());
    expect(window.history.state).toEqual(ROUTER_STATE);
  });

  it('keeps a URL rewritten under the sheet when the user presses Back', async () => {
    // Activity mirrors its filters into the URL while its menu is open. The
    // Navigation API knows the URL the sheet's entry ended with.
    installNavigation();
    render(<Page />);
    await userEvent.click(screen.getByText('Open sheet'));
    window.history.replaceState({ ...window.history.state }, '', '/calendar?source=sonarr');
    await back();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.search).toBe('?source=sonarr');
  });

  describe.each([['with', true], ['without', false]])('%s the Navigation API', (_label, withApi) => {
    beforeEach(() => { if (withApi) installNavigation(); });

    // Back closed the picker; Forward lands on its closed entry.
    it('does nothing on Forward after Back closed a picker, leaving the sheet open', async () => {
      render(<Page />);
      await userEvent.click(screen.getByText('Open sheet'));
      await userEvent.click(screen.getByText('Open picker'));
      const sheetMarker = await waitFor(() => {
        const value = marker();
        expect(value).toEqual(expect.any(String));
        return value;
      });
      await back();
      expect(screen.queryByRole('dialog', { name: 'picker' })).toBeNull();
      await forward();
      expect(screen.getByRole('dialog', { name: 'sheet' })).toBeTruthy();
      expect(screen.queryByRole('dialog', { name: 'picker' })).toBeNull();
      expect(marker()).not.toBe(sheetMarker);
      // The sheet's own entry is current: one Back closes the sheet only.
      await back();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('keeps a lower sheet\'s marker when it puts a rewritten URL back on its entry', async () => {
      render(<Page />);
      await userEvent.click(screen.getByText('Open sheet'));
      await userEvent.click(screen.getByText('Open picker'));
      await waitFor(() => expect(window.history.length).toBeGreaterThan(0));
      // The page rewrites its URL the router's way, which keeps no custom keys.
      window.history.replaceState({ __NA: true }, '', '/calendar?view=week');
      if (withApi) await back();
      else {
        await userEvent.click(screen.getByText('Close picker'));
        await waitFor(() => expect(window.location.search).toBe('?view=week'));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      }
      expect(window.location.search).toBe('?view=week');
      expect(screen.getByRole('dialog', { name: 'sheet' })).toBeTruthy();
      expect(marker()).toEqual(expect.any(String));
      // A picker opened again closes alone on Back.
      await userEvent.click(screen.getByText('Open picker'));
      await back();
      expect(screen.queryByRole('dialog', { name: 'picker' })).toBeNull();
      expect(screen.getByRole('dialog', { name: 'sheet' })).toBeTruthy();
    });
  });

  it('treats an entry the router rewrote without our marker as closed, and the page never sees the landing', async () => {
    const navigation = installNavigation();
    render(<Page />);
    await userEvent.click(screen.getByText('Open sheet'));
    const baseKey = 'k0';
    // Prowlarr: the router's replace for ?indexer= lands after the sheet's push.
    window.history.replaceState({ __NA: true }, '', '/calendar?indexer=7');
    await back();
    expect(screen.queryByRole('dialog')).toBeNull();
    const seen: string[] = [];
    const listener = () => seen.push(navigation.key());
    window.addEventListener('popstate', listener);
    try {
      await forward();
      expect(navigation.key()).toBe(baseKey);
      // Only our step back reached the page, not the landing on the closed entry.
      expect(seen).toEqual([baseKey]);
    } finally {
      window.removeEventListener('popstate', listener);
    }
  });

  it('steps on with Forward past a closed entry when there is more ahead', async () => {
    installNavigation();
    render(<Page />);
    await userEvent.click(screen.getByText('Open sheet'));
    await userEvent.click(screen.getByText('Close sheet'));
    await settled();
    // A closed overlay's entry with a page after it.
    window.history.pushState({ ...ROUTER_STATE, __helprrOverlay: 999 }, '');
    window.history.pushState(ROUTER_STATE, '', '/next');
    await act(async () => {
      window.history.go(-2);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(window.location.pathname).toBe('/calendar');
    await forward();
    expect(window.location.pathname).toBe('/next');
  });

  it('leaves an older visit\'s URL alone when Back jumps further than the entry below', async () => {
    installNavigation();
    window.history.pushState(ROUTER_STATE, '', '/calendar?view=old');
    window.history.pushState(ROUTER_STATE, '', '/calendar');
    const seen: boolean[] = [];
    const listener = (event: PopStateEvent) => seen.push(isOverlayPopState(event));
    window.addEventListener('popstate', listener);
    try {
      render(<Page />);
      await userEvent.click(screen.getByText('Open sheet'));
      window.history.replaceState({ ...window.history.state }, '', '/calendar?view=new');
      await act(async () => {
        window.history.go(-2);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(window.location.search).toBe('?view=old');
      expect(seen).toEqual([false]);
    } finally {
      window.removeEventListener('popstate', listener);
    }
  });

  describe.each([['with', true], ['without', false]])('after a reload, %s the Navigation API', (_label, withApi) => {
    beforeEach(() => { if (withApi) installNavigation(); });

    // The page reloaded with a sheet open: it sits on that sheet's entry,
    // whose marker is the earlier page load's, and ids count from 1 again.
    it('closes a sheet opened after it on the first Back, then steps past the old entry', async () => {
      window.history.pushState({ ...ROUTER_STATE, __helprrOverlay: 'earlier-load:1' }, '');
      render(<Page />);
      await userEvent.click(screen.getByText('Open sheet'));
      await back();
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(marker()).toBeUndefined();
      expect(window.location.pathname).toBe('/calendar');
    });
  });

  it('lets the landing through when a closed entry can\'t be stepped past', async () => {
    const navigation = installNavigation();
    render(<Page />);
    await userEvent.click(screen.getByText('Open sheet'));
    await userEvent.click(screen.getByText('Close sheet'));
    await settled();
    // The first entry is an earlier page load's sheet: nothing below it.
    window.history.replaceState({ ...ROUTER_STATE, __helprrOverlay: 'earlier-load:1' }, '');
    const seen: string[] = [];
    const listener = () => seen.push(navigation.key());
    window.addEventListener('popstate', listener);
    try {
      // Forward onto the closed sheet's entry steps back onto the first one,
      // which can't be left: that landing reaches the page.
      await forward();
      expect(navigation.key()).toBe('k0');
      expect(seen).toEqual(['k0']);
      // Settled: a sheet opens again as usual.
      await userEvent.click(screen.getByText('Open sheet'));
      await waitFor(() => expect(marker()).not.toBe('earlier-load:1'));
      expect(navigation.key()).not.toBe('k0');
    } finally {
      window.removeEventListener('popstate', listener);
    }
  });

  it('reports a Forward that bounced back off a closed entry as overlay-only, without the Navigation API', async () => {
    const seen: boolean[] = [];
    const listener = (event: PopStateEvent) => seen.push(isOverlayPopState(event));
    render(<Page />);
    await userEvent.click(screen.getByText('Open sheet'));
    window.addEventListener('popstate', listener);
    try {
      await back();
      expect(screen.queryByRole('dialog')).toBeNull();
      await forward();
      expect(marker()).toBeUndefined();
      // The Back that closed the sheet, and the bounce: the landing on the
      // closed entry itself never reached the page.
      expect(seen).toEqual([true, true]);
    } finally {
      window.removeEventListener('popstate', listener);
    }
  });
});
