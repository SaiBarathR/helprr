// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { afterOverlayHistory, resetOverlayHistoryForTests } from '@/lib/overlay-history';
import { useLeaveConfirm } from '../use-unsaved-changes-guard';

// NavigationProvider's router: push and back wait for overlay entries to be
// off history, as the real one does.
const nav = vi.hoisted(() => ({ canGoBack: true, push: vi.fn(), back: vi.fn() }));
vi.mock('@/components/layout/navigation-provider', () => ({
  canGoBackInApp: () => nav.canGoBack,
  useAppRouter: () => nav,
}));

const ROUTER_STATE = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: 'page' } };
const marker = () => (window.history.state as Record<string, unknown> | null)?.__helprrOverlay;
const popstate = () => new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
// The system Back: one traversal, then the overlay module settles a tick later.
const systemBack = () => act(async () => {
  window.history.back();
  await popstate();
  await new Promise((resolve) => setTimeout(resolve, 5));
});

function Page({ initialDirty = true }: { initialDirty?: boolean }) {
  const [dirty, setDirty] = useState(initialDirty);
  const [sheet, setSheet] = useState(false);
  const leave = useLeaveConfirm(dirty, '/settings');
  return (
    <>
      <button onClick={leave.leave}>Settings</button>
      <button onClick={() => setDirty(false)}>Save</button>
      <button onClick={() => setDirty(true)}>Edit</button>
      <button onClick={() => setSheet(true)}>Open sheet</button>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Pick one</SheetDescription>
        </SheetContent>
      </Sheet>
      <ConfirmDialog {...leave.dialog} title="Discard unsaved changes?" confirmLabel="Discard changes" cancelLabel="Keep editing" />
    </>
  );
}

let pageLength: number;
beforeEach(() => {
  resetOverlayHistoryForTests();
  nav.canGoBack = true;
  nav.push.mockReset();
  nav.back.mockReset().mockImplementation(() => afterOverlayHistory(() => window.history.back()));
  // Settings, then the page with the edits on top of it.
  window.history.pushState(ROUTER_STATE, '', '/settings');
  window.history.pushState(ROUTER_STATE, '', '/settings/downloads');
  pageLength = window.history.length;
});
afterEach(() => vi.restoreAllMocks());

it('holds no history entry while there is nothing unsaved, and drops it once saved', async () => {
  const { unmount } = render(<Page initialDirty={false} />);
  expect(window.history.length).toBe(pageLength);
  unmount();

  render(<Page />);
  await waitFor(() => expect(marker()).toBeDefined());
  expect(window.history.length).toBe(pageLength + 1);
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(marker()).toBeUndefined());
  expect(window.location.pathname).toBe('/settings/downloads');
});

it('asks on the system Back; Keep editing stays with the edits and the guard back in place', async () => {
  render(<Page />);
  await waitFor(() => expect(marker()).toBeDefined());

  await systemBack();
  expect(await screen.findByRole('alertdialog')).toBeTruthy();
  expect(window.location.pathname).toBe('/settings/downloads');

  await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  // The next Back asks again.
  await waitFor(() => expect(marker()).toBeDefined());
  expect(window.location.pathname).toBe('/settings/downloads');
  await systemBack();
  expect(await screen.findByRole('alertdialog')).toBeTruthy();
  expect(nav.push).not.toHaveBeenCalled();
});

it('a confirmed system Back leaves to the page before, with no second press', async () => {
  render(<Page />);
  await waitFor(() => expect(marker()).toBeDefined());
  await systemBack();
  await screen.findByRole('alertdialog');

  const landed = popstate();
  await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  await act(async () => {
    await landed;
    await waitFor(() => expect(window.location.pathname).toBe('/settings'));
  });
  expect(nav.back).toHaveBeenCalledTimes(1);
  expect(nav.push).not.toHaveBeenCalled();
});

it('the confirm Back opened holds no entry, so a second Back leaves the page', async () => {
  render(<Page />);
  await waitFor(() => expect(marker()).toBeDefined());
  await systemBack();
  await screen.findByRole('alertdialog');
  // Nothing pushed for the confirm: Chrome would skip the page entry under it.
  expect(marker()).toBeUndefined();
  expect(window.history.length).toBe(pageLength + 1);
  await systemBack();
  expect(window.location.pathname).toBe('/settings');
});

it('a confirmed Back at the start of history goes to the parent page instead', async () => {
  render(<Page />);
  await waitFor(() => expect(marker()).toBeDefined());
  nav.canGoBack = false;
  await systemBack();
  await screen.findByRole('alertdialog');
  // Still opened by Back: no entry of its own (Chrome would skip the page
  // under it, and with nothing before the page, close the tab).
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(marker()).toBeUndefined();
  expect(window.history.length).toBe(pageLength + 1);
  await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/settings'));
  expect(nav.back).not.toHaveBeenCalled();
});

it('the page link asks while dirty and leaves to its href, without the guard asking again', async () => {
  render(<Page />);
  await waitFor(() => expect(marker()).toBeDefined());
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await screen.findByRole('alertdialog');
  await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(nav.push).toHaveBeenCalledWith('/settings');
  expect(nav.back).not.toHaveBeenCalled();
});

it('the page link leaves at once when nothing is unsaved', async () => {
  render(<Page initialDirty={false} />);
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(nav.push).toHaveBeenCalledWith('/settings');
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('another in-app navigation takes the guard entry off without asking', async () => {
  render(<Page />);
  await waitFor(() => expect(marker()).toBeDefined());
  const navigate = vi.fn();
  await act(async () => {
    afterOverlayHistory(navigate);
    await popstate();
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(window.history.length).toBe(pageLength + 1);
  expect(marker()).toBeUndefined();
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('dirty and clean toggles leave at most one guard entry, and none once clean', async () => {
  render(<Page initialDirty={false} />);
  for (let i = 0; i < 3; i++) {
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(marker()).toBeDefined());
    expect(window.history.length).toBe(pageLength + 1);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(marker()).toBeUndefined());
  }
  expect(window.location.pathname).toBe('/settings/downloads');
  // The next Back leaves straight away.
  await act(async () => { window.history.back(); await popstate(); });
  expect(window.location.pathname).toBe('/settings');
});

it('a sheet over a dirty page: Back closes the sheet, the next Back asks', async () => {
  render(<Page />);
  await waitFor(() => expect(marker()).toBeDefined());
  await userEvent.click(screen.getByRole('button', { name: 'Open sheet' }));
  await screen.findByRole('dialog', { name: 'Filters' });
  await waitFor(() => expect(window.history.length).toBe(pageLength + 2));

  await systemBack();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull());
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(window.location.pathname).toBe('/settings/downloads');

  await systemBack();
  expect(await screen.findByRole('alertdialog')).toBeTruthy();
  expect(window.location.pathname).toBe('/settings/downloads');
});
