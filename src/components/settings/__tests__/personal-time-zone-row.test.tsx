// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import { PersonalTimeZoneRow } from '../personal-time-zone-row';

// cmdk and Radix Popover need these, which jsdom lacks.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

const fetchMock = vi.fn();
let stored: string | null = null;

function renderRow() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><PersonalTimeZoneRow /></QueryClientProvider>);
}

beforeEach(() => {
  stored = null;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return new Response('{}', { status: 200 });
    return new Response(JSON.stringify({ timeZone: stored, serverTimeZone: 'Europe/London' }));
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const patches = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(init.body));

describe('Your time zone', () => {
  it('defaults to "Same as the server", and saves a zone found by search', async () => {
    renderRow();
    const trigger = await screen.findByRole('button', { name: 'Your time zone' });
    await waitFor(() => expect(trigger.textContent).toBe('Same as the server'));
    await userEvent.click(trigger);
    // The first choice names the server's zone.
    expect((await screen.findByRole('option', { name: /Same as the server/ })).textContent).toContain('Europe/London');
    await userEvent.type(screen.getByPlaceholderText('Search time zones'), 'new york');
    await userEvent.click(await screen.findByRole('option', { name: 'America/New York' }));
    await waitFor(() => expect(patches()).toEqual([{ timeZone: 'America/New_York' }]));
    expect(trigger.textContent).toBe('America/New York');
  });

  it('goes back to the server zone with null', async () => {
    stored = 'Asia/Tokyo';
    renderRow();
    const trigger = await screen.findByRole('button', { name: 'Your time zone' });
    await waitFor(() => expect(trigger.textContent).toBe('Asia/Tokyo'));
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('option', { name: /Same as the server/ }));
    await waitFor(() => expect(patches()).toEqual([{ timeZone: null }]));
  });

  it('puts the old zone back when saving fails', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? new Response('{}', { status: 500 })
        : new Response(JSON.stringify({ timeZone: null, serverTimeZone: 'UTC' })));
    renderRow();
    const trigger = await screen.findByRole('button', { name: 'Your time zone' });
    await waitFor(() => expect(trigger.textContent).toBe('Same as the server'));
    await userEvent.click(trigger);
    await userEvent.type(screen.getByPlaceholderText('Search time zones'), 'tokyo');
    await userEvent.click(await screen.findByRole('option', { name: 'Asia/Tokyo' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() => expect(trigger.textContent).toBe('Same as the server'));
  });
});
