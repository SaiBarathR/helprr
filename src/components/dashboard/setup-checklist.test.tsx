// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupChecklistState } from '@/lib/setup-checklist-steps';

const mocks = vi.hoisted(() => ({ standalone: false, toastError: vi.fn(), toast: vi.fn() }));
vi.mock('@/hooks/use-is-standalone', () => ({ useIsStandalone: () => mocks.standalone }));
vi.mock('sonner', () => ({ toast: Object.assign(mocks.toast, { error: mocks.toastError }) }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock('@/components/ui/drawer', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Drawer: Pass, DrawerClose: Pass, DrawerContent: Pass, DrawerDescription: Pass, DrawerFooter: Pass, DrawerHeader: Pass, DrawerTitle: Pass };
});

// The drawer has its own tests (open-on-phone.test.tsx); here, only that it opens.
vi.mock('next/dynamic', () => ({
  default: () =>
    function OpenOnPhoneStub({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
      return (
        <div data-testid="phone-drawer" data-open={String(open)}>
          {open && <div role="dialog" aria-label="Open on your phone" />}
          <button type="button" aria-label="Close phone drawer" onClick={() => onOpenChange(false)} />
        </div>
      );
    },
}));

import { SetupChecklist } from './setup-checklist';

const fresh: SetupChecklistState = {
  hidden: false,
  done: { service: true, people: false, push: false, install: false, backup: false },
};

function respond(body: SetupChecklistState | null, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('SetupChecklist', () => {
  beforeEach(() => {
    mocks.standalone = false;
    mocks.toastError.mockReset();
    mocks.toast.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists every step with its link, counting only the required ones', () => {
    respond(fresh);
    render(<SetupChecklist initial={fresh} mobile={false} />);
    expect(screen.getByRole('heading', { name: 'Set up Helprr' })).toBeTruthy();
    expect(screen.getByText(/1 of 4/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Connect your first service, done/ }).getAttribute('href')).toBe('/settings/instances');
    expect(screen.getByRole('link', { name: /Turn on push notifications/ }).getAttribute('href')).toBe('/settings/notifications/check');
    expect(screen.getByRole('link', { name: /Install on your phone/ }).getAttribute('href')).toBe('/settings/appearance#install');
    expect(screen.getByText('(optional)')).toBeTruthy();
    // Only what the server cannot see can be marked by hand.
    expect(screen.getByRole('button', { name: 'Skip: Add people' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done: Install on your phone' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done: Back up the database' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Turn on push/ })).toBeNull();
  });

  it('counts the required steps and the optional one apart, from the ticks it shows', () => {
    const states: Array<[SetupChecklistState['done'], RegExp, number]> = [
      [{ service: false, people: false, push: false, install: false, backup: false }, /^Getting started · 0 of 4 done$/, 0],
      [{ service: true, people: true, push: false, install: false, backup: false }, /^Getting started · 1 of 4 done · \+1 optional$/, 2],
      [{ service: true, people: false, push: true, install: true, backup: false }, /^Getting started · 3 of 4 done$/, 3],
      [{ service: false, people: true, push: false, install: false, backup: false }, /^Getting started · 0 of 4 done · \+1 optional$/, 1],
    ];
    for (const [done, count, ticks] of states) {
      const { unmount } = render(<SetupChecklist initial={{ hidden: false, done }} mobile />);
      expect(screen.getByText(/^Getting started/).textContent).toMatch(count);
      expect(screen.queryAllByRole('link', { name: /, done/ })).toHaveLength(ticks);
      unmount();
    }
  });

  it('gives every step the same link to its settings page, with a chevron', () => {
    render(<SetupChecklist initial={fresh} mobile />);
    const expected: Array<[RegExp, string]> = [
      [/^Connect your first service/, '/settings/instances'],
      [/^Add people/, '/settings/users'],
      [/^Turn on push notifications/, '/settings/notifications/check'],
      [/^Install on your phone/, '/settings/appearance#install'],
      [/^Back up the database/, '/settings/backup'],
    ];
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(expected.length);
    expected.forEach(([name, href], index) => {
      expect(links[index].textContent).toMatch(name);
      expect(links[index].getAttribute('href')).toBe(href);
      expect(links[index].querySelector('svg.lucide-chevron-right')).toBeTruthy();
    });
  });

  it('renders nothing once hidden, or once every required step is done', () => {
    const { container, rerender } = render(<SetupChecklist initial={{ ...fresh, hidden: true }} mobile />);
    expect(container.innerHTML).toBe('');
    rerender(
      <SetupChecklist
        initial={{ hidden: false, done: { service: true, people: false, push: true, install: true, backup: true } }}
        mobile
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('ticks a step at once and saves it', async () => {
    const saved = { ...fresh, done: { ...fresh.done, backup: true } };
    const fetchMock = respond(saved);
    render(<SetupChecklist initial={fresh} mobile />);
    await userEvent.click(screen.getByRole('button', { name: 'Done: Back up the database' }));
    expect(screen.getByRole('link', { name: /Back up the database, done/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Done: Back up the database' })).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'done', step: 'backup' });
    await waitFor(() => expect(screen.getByText(/2 of 4/)).toBeTruthy());
  });

  it('shows a skipped optional step as skipped, not done, and does not count it', async () => {
    const fetchMock = respond({ ...fresh, skipped: ['people'] });
    const { unmount } = render(<SetupChecklist initial={fresh} mobile />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip: Add people' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'done', step: 'people' });
    const link = screen.getByRole('link', { name: /^Add people ?· Skipped/ });
    expect(link.textContent).not.toMatch(/, done/);
    expect(link.textContent).not.toMatch(/\(optional\)/);
    expect(screen.queryByRole('button', { name: 'Skip: Add people' })).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/^Getting started/).textContent).toMatch(/^Getting started · 1 of 4 done$/);
    unmount();

    // As the server sends it after a reload; a real tick (someone was added) wins.
    render(<SetupChecklist initial={{ ...fresh, skipped: ['people'] }} mobile />);
    expect(screen.getByRole('link', { name: /^Add people ?· Skipped/ })).toBeTruthy();
  });

  it('puts a step back and says so when saving fails', async () => {
    respond(null, false);
    render(<SetupChecklist initial={fresh} mobile />);
    await userEvent.click(screen.getByRole('button', { name: 'Done: Install on your phone' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Done: Install on your phone' })).toBeTruthy();
  });

  it('hides at once when dismissed', async () => {
    const fetchMock = respond({ ...fresh, hidden: true });
    const { container } = render(<SetupChecklist initial={fresh} mobile={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hide the setup checklist' }));
    expect(container.innerHTML).toBe('');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'dismiss' });
  });

  it('keeps a newer tick when an older reply arrives last, and undoes only a failed step', async () => {
    const replies: Array<(value: unknown) => void> = [];
    const fetchMock = vi.fn(() => new Promise((resolve) => replies.push(resolve)));
    vi.stubGlobal('fetch', fetchMock);
    render(<SetupChecklist initial={fresh} mobile />);
    await userEvent.click(screen.getByRole('button', { name: 'Done: Install on your phone' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done: Back up the database' }));
    // The backup reply comes first and saw both; the install reply, read before the
    // backup was saved, comes last.
    replies[1]({ ok: true, json: async () => ({ hidden: false, done: { ...fresh.done, install: true, backup: true } }) });
    replies[0]({ ok: true, json: async () => ({ hidden: false, done: { ...fresh.done, install: true } }) });
    await waitFor(() => expect(screen.getByRole('link', { name: /Back up the database, done/ })).toBeTruthy());
    expect(screen.getByText(/3 of 4/)).toBeTruthy();

    // A failed save undoes its own step, not the others.
    await userEvent.click(screen.getByRole('button', { name: 'Skip: Add people' }));
    replies[2]({ ok: false, json: async () => null });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Skip: Add people' })).toBeTruthy());
    expect(screen.getByRole('link', { name: /Back up the database, done/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Install on your phone, done/ })).toBeTruthy();
  });

  it('moves focus to the step when its button goes away', async () => {
    respond(fresh);
    render(<SetupChecklist initial={fresh} mobile />);
    await userEvent.click(screen.getByRole('button', { name: 'Done: Back up the database' }));
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /Back up the database, done/ }));
  });

  it('offers Undo after hiding, which brings it back', async () => {
    const fetchMock = respond(fresh);
    const { container } = render(<SetupChecklist initial={fresh} mobile />);
    await userEvent.click(screen.getByRole('button', { name: 'Hide the setup checklist' }));
    expect(container.innerHTML).toBe('');
    const [, options] = mocks.toast.mock.calls[0];
    act(() => options.action.onClick());
    expect(screen.getByRole('heading', { name: 'Set up Helprr' })).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map((call) => JSON.parse(call[1].body))).toEqual([{ action: 'dismiss' }, { action: 'restore' }]);
  });

  it('sends Undo only after the hide is saved, so the server ends shown', async () => {
    const replies: Array<(value: unknown) => void> = [];
    const fetchMock = vi.fn(() => new Promise((resolve) => replies.push(resolve)));
    vi.stubGlobal('fetch', fetchMock);
    render(<SetupChecklist initial={fresh} mobile />);
    await userEvent.click(screen.getByRole('button', { name: 'Hide the setup checklist' }));
    act(() => mocks.toast.mock.calls[0][1].action.onClick());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    replies[0]({ ok: true, json: async () => ({ ...fresh, hidden: true }) });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse((fetchMock.mock.calls[1] as unknown as [string, { body: string }])[1].body)).toEqual({ action: 'restore' });
    // A failed hide after Undo does not hide it again or complain.
    replies[1]({ ok: true, json: async () => fresh });
    expect(screen.getByRole('heading', { name: 'Set up Helprr' })).toBeTruthy();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('does not roll back a hide that the user already undid', async () => {
    const replies: Array<(value: unknown) => void> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => replies.push(resolve))));
    render(<SetupChecklist initial={fresh} mobile />);
    await userEvent.click(screen.getByRole('button', { name: 'Hide the setup checklist' }));
    act(() => mocks.toast.mock.calls[0][1].action.onClick());
    replies[0]({ ok: false, json: async () => null });
    await waitFor(() => expect(replies).toHaveLength(2));
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Set up Helprr' })).toBeTruthy();
  });

  it('offers a QR code for the phone on a computer, and opens it', async () => {
    respond(fresh);
    render(<SetupChecklist initial={fresh} mobile={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show a code to open Helprr on your phone' }));
    expect(screen.getByRole('dialog', { name: 'Open on your phone' })).toBeTruthy();
  });

  it('keeps the drawer mounted after closing, so it can slide away and open again', async () => {
    respond(fresh);
    render(<SetupChecklist initial={fresh} mobile={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show a code to open Helprr on your phone' }));
    expect(screen.getByTestId('phone-drawer').dataset.open).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Close phone drawer' }));
    expect(screen.getByTestId('phone-drawer').dataset.open).toBe('false');
    await userEvent.click(screen.getByRole('button', { name: 'Show a code to open Helprr on your phone' }));
    expect(screen.getByTestId('phone-drawer').dataset.open).toBe('true');
  });

  it('does not offer the code on the phone itself', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
    respond(fresh);
    render(<SetupChecklist initial={fresh} mobile />);
    expect(screen.queryByRole('button', { name: 'Show a code to open Helprr on your phone' })).toBeNull();
  });

  it('does not mark the phone step from an installed desktop app window', async () => {
    mocks.standalone = true;
    const fetchMock = respond(fresh);
    render(<SetupChecklist initial={fresh} mobile={false} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks the install step by itself when opened as an installed app on a phone', async () => {
    mocks.standalone = true;
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15');
    const fetchMock = respond({ ...fresh, done: { ...fresh.done, install: true } });
    render(<SetupChecklist initial={fresh} mobile />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'done', step: 'install' });
    expect(screen.getByRole('link', { name: /Install on your phone, done/ })).toBeTruthy();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
