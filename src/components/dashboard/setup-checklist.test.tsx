// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupChecklistState } from '@/lib/setup-checklist-steps';

const mocks = vi.hoisted(() => ({ standalone: false, toastError: vi.fn() }));
vi.mock('@/hooks/use-is-standalone', () => ({ useIsStandalone: () => mocks.standalone }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
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
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists every step with its link, counting only the required ones', () => {
    respond(fresh);
    render(<SetupChecklist initial={fresh} mobile={false} />);
    expect(screen.getByRole('heading', { name: 'Set up Helprr' })).toBeTruthy();
    expect(screen.getByText(/1 of 4/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Connect your first service, done/ }).getAttribute('href')).toBe('/settings/instances');
    expect(screen.getByRole('link', { name: /Turn on push notifications/ }).getAttribute('href')).toBe('/settings/notifications');
    expect(screen.getByRole('link', { name: /Install on your phone/ }).getAttribute('href')).toBe('/settings/appearance#install');
    expect(screen.getByText('(optional)')).toBeTruthy();
    // Only what the server cannot see can be marked by hand.
    expect(screen.getByRole('button', { name: 'Skip: Add people' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done: Install on your phone' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done: Export a backup' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Turn on push/ })).toBeNull();
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
    await userEvent.click(screen.getByRole('button', { name: 'Done: Export a backup' }));
    expect(screen.getByRole('link', { name: /Export a backup, done/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Done: Export a backup' })).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'done', step: 'backup' });
    await waitFor(() => expect(screen.getByText(/2 of 4/)).toBeTruthy());
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

  it('marks the install step by itself when opened as an installed app', async () => {
    mocks.standalone = true;
    const fetchMock = respond({ ...fresh, done: { ...fresh.done, install: true } });
    render(<SetupChecklist initial={fresh} mobile />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'done', step: 'install' });
    expect(screen.getByRole('link', { name: /Install on your phone, done/ })).toBeTruthy();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
