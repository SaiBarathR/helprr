// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/layout/navigation-provider', () => ({
  useAppRouter: () => ({ back: vi.fn(), push: vi.fn() }),
  canGoBackInApp: () => true,
}));
vi.mock('@/lib/query-client', () => ({ handleAuthError: vi.fn() }));
// Native stand-in: Radix Select needs pointer APIs jsdom lacks.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select aria-label="Show" value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import TorrentLogPage from './page';

const entry = (id: number, level: string, message: string) => ({ id, level, message, time: new Date(Date.now() - id * 1000).toISOString() });
let urls: string[];

beforeEach(() => {
  urls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    if (url.includes('before=7')) return Response.json({ entries: [entry(6, 'info', 'Older line')], nextBefore: null });
    return Response.json({ entries: [entry(9, 'critical', 'File error alert'), entry(7, 'warning', 'Tracker failed')], nextBefore: 7 });
  }));
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><TorrentLogPage /></QueryClientProvider>);
}

describe('qBittorrent log page (QBT-24)', () => {
  it('lists the newest entries first with their level, and loads older ones', async () => {
    renderPage();
    await screen.findByText('File error alert');
    expect(screen.getByText('Critical')).toBeTruthy();
    expect(screen.getByText('Warning')).toBeTruthy();
    expect(urls[0]).toBe('/api/qbittorrent/log?levels=normal,info,warning,critical');

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Older line');
    expect(urls.at(-1)).toBe('/api/qbittorrent/log?levels=normal,info,warning,critical&before=7');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('asks for the chosen levels only', async () => {
    renderPage();
    await screen.findByText('File error alert');
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'warning');
    await waitFor(() => expect(urls.at(-1)).toBe('/api/qbittorrent/log?levels=warning,critical'));
  });
});
