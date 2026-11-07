// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The confirm dialog is reduced to its confirm button.
vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: ({ open, confirmLabel, onConfirm }: { open: boolean; confirmLabel?: string; onConfirm: () => void }) =>
    (open ? <button onClick={onConfirm}>{confirmLabel}</button> : null),
}));

import { ApiTokensSection } from './api-tokens-section';

const TOKEN = `hlp_${'q'.repeat(43)}`;
const LIST = {
  tokens: [{
    id: 'tok-1',
    name: 'Homepage',
    scopes: ['activity.view', 'jellyfin.sessions'],
    activeScopes: ['activity.view'],
    expiresAt: null,
    createdAt: '2026-11-01T00:00:00Z',
    lastUsedAt: null,
  }],
  allowed: true,
  grantableScopes: ['activity.view', 'calendar.view'],
  max: 10,
};

const fetchMock = vi.fn();

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/me/api-tokens' && init?.method === 'POST') {
      return new Response(JSON.stringify({ id: 'tok-2', token: TOKEN, name: 'iPhone', scopes: ['calendar.view'], expiresAt: null, createdAt: 'now' }), { status: 200 });
    }
    if (init?.method === 'DELETE') return new Response(JSON.stringify({ revoked: true }), { status: 200 });
    return new Response(JSON.stringify(LIST), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function listing(body: object) {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

describe('ApiTokensSection', () => {
  it('without api.tokens offers no new token and says why', async () => {
    listing({ ...LIST, tokens: [], allowed: false });
    render(<ApiTokensSection />, { wrapper });
    expect(await screen.findByText('Not turned on for you')).toBeTruthy();
    expect(screen.queryByText('New API token')).toBeNull();
    expect(screen.getByText(/Making API tokens is not turned on for you/)).toBeTruthy();
  });

  it('without api.tokens still lists old tokens, marked as not working, so they can be turned off', async () => {
    listing({ ...LIST, allowed: false });
    render(<ApiTokensSection />, { wrapper });
    expect(await screen.findByText('Homepage')).toBeTruthy();
    expect(screen.getByText('Not working: API tokens are turned off for you')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Turn off Homepage' })).toBeTruthy();
    expect(screen.queryByText('New API token')).toBeNull();
  });

  it('lists tokens, and says which scopes are not used now', async () => {
    render(<ApiTokensSection />, { wrapper });
    expect(await screen.findByText('Homepage')).toBeTruthy();
    expect(screen.getByText('API tokens · 1')).toBeTruthy();
    expect(screen.getByText(/No expiry · not used yet/)).toBeTruthy();
    expect(screen.getByText(/no longer have access: Active Jellyfin streams/)).toBeTruthy();
  });

  it('offers only scopes the person holds, and shows a new token once', async () => {
    const user = userEvent.setup();
    render(<ApiTokensSection />, { wrapper });
    await user.click(await screen.findByRole('button', { name: /New API token/ }));

    expect(screen.getByRole('checkbox', { name: 'Next releases' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Download queue (size and items)' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Active Jellyfin streams' })).toBeNull();

    const make = screen.getByRole('button', { name: 'Make token' });
    expect((make as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText('Name'), 'iPhone');
    await user.click(screen.getByRole('checkbox', { name: 'Next releases' }));
    await user.click(make);

    const shown = await screen.findByLabelText('API token');
    expect((shown as HTMLInputElement).value).toBe(TOKEN);
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(JSON.parse(init.body)).toEqual({ name: 'iPhone', scopes: ['calendar.view'], expiresInDays: 90 });

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByLabelText('API token')).toBeNull());
  });

  it('turns a token off', async () => {
    const user = userEvent.setup();
    render(<ApiTokensSection />, { wrapper });
    await user.click(await screen.findByRole('button', { name: 'Turn off Homepage' }));
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/me/api-tokens/tok-1', { method: 'DELETE' }));
  });
});
