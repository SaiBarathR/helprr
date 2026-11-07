// @vitest-environment jsdom
import type React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import { WatchingWindowRow } from './watching-window-row';

const fetchMock = vi.fn();

function renderRow() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><WatchingWindowRow /></QueryClientProvider>);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WatchingWindowRow', () => {
  it('shows the saved window and saves a new one, Off included', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => new Response(
      JSON.stringify(init?.method === 'PATCH' ? {} : { watchingEpisodeDays: 30, jellyfinLinked: true }),
      { status: 200 },
    ));
    renderRow();
    const select = await screen.findByRole('combobox');
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('30'));

    await userEvent.selectOptions(select, '0');
    expect((select as HTMLSelectElement).value).toBe('0');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/me/settings');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ watchingEpisodeDays: 0 });
  });

  it('points an unlinked person to linking Jellyfin instead', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ watchingEpisodeDays: 14, jellyfinLinked: false }), { status: 200 }));
    renderRow();
    expect((await screen.findByRole('link', { name: 'Link it in Account' })).getAttribute('href')).toBe('/settings/account');
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
