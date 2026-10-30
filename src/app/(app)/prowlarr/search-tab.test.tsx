// @vitest-environment jsdom
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SearchTab } from './search-tab';

vi.mock('@/lib/hooks/use-route-view-state', () => ({
  useRouteViewState: <T,>(_name: string, initial: T) => useState<T>(initial),
}));

const result = (id: string, title: string, publishDate: string | null) => ({
  id, title, size: 1024, seeders: 5, leechers: 1, publishDate, indexer: 'YTS', protocol: 'torrent',
});

const searches = () => vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).startsWith('/api/prowlarr/search?'));

function setup() {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}><SearchTab /></QueryClientProvider>);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [result('a', 'Big Buck Bunny', '2026-01-01')] }))));
});

describe('SearchTab', () => {
  it('searches only from the button, sending the chosen categories then', async () => {
    setup();
    await userEvent.type(screen.getByRole('textbox'), 'bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Movies' }));
    expect(searches()).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Big Buck Bunny');
    expect(String(searches()[0][0])).toContain('q=bunny&categories=2000');

    await userEvent.click(screen.getByRole('button', { name: 'TV' }));
    expect(searches()).toHaveLength(1);
  });

  it('searches again for the same text, so a retry or expired result works', async () => {
    setup();
    await userEvent.type(screen.getByRole('textbox'), 'bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Big Buck Bunny');

    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(searches()).toHaveLength(2));
  });

  it('does not claim nothing exists when nothing came back', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ results: [] })));
    setup();
    await userEvent.type(screen.getByRole('textbox'), 'bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText(/an indexer may have failed/)).toBeTruthy();
  });

  it('sorts missing dates last under Newest', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      results: [result('a', 'Old', '2020-01-01'), result('b', 'Unknown', null), result('c', 'New', '2026-01-01')],
    })));
    setup();
    await userEvent.type(screen.getByRole('textbox'), 'bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Old');

    await userEvent.click(screen.getByRole('button', { name: 'Newest' }));

    const titles = screen.getAllByRole('button', { name: /^Grab / }).map((button) => button.getAttribute('aria-label'));
    expect(titles).toEqual(['Grab New', 'Grab Old', 'Grab Unknown']);
  });
});
