// @vitest-environment jsdom
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SearchTab } from './search-tab';

vi.mock('@/lib/hooks/use-route-view-state', () => ({
  useRouteViewState: <T,>(_name: string, initial: T) => useState<T>(initial),
}));

// jsdom lacks these; the options sheet (vaul) calls them.
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

const result = (id: string, title: string, publishDate: string | null) => ({
  id, title, size: 1024, seeders: 5, leechers: 1, publishDate, indexer: 'YTS', protocol: 'torrent',
});

const searches = () => vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).startsWith('/api/prowlarr/search?'));

function setup() {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}><SearchTab /></QueryClientProvider>);
}

const indexers = [
  { id: 1, name: 'YTS', enable: true, protocol: 'torrent', privacy: 'public' },
  { id: 2, name: 'Nyaa', enable: true, protocol: 'torrent', privacy: 'public' },
  { id: 3, name: 'Off', enable: false, protocol: 'torrent', privacy: 'private' },
];

function answer(body: unknown) {
  vi.mocked(fetch).mockImplementation(async (url) => new Response(JSON.stringify(
    String(url).startsWith('/api/prowlarr/indexers') ? indexers : body,
  )));
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  answer({ results: [result('a', 'Big Buck Bunny', '2026-01-01')], total: 1 });
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
    answer({ results: [], total: 0 });
    setup();
    await userEvent.type(screen.getByRole('textbox'), 'bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText(/an indexer may have failed/)).toBeTruthy();
  });

  it('sorts missing dates last under Newest', async () => {
    answer({ results: [result('a', 'Old', '2020-01-01'), result('b', 'Unknown', null), result('c', 'New', '2026-01-01')], total: 3 });
    setup();
    await userEvent.type(screen.getByRole('textbox'), 'bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Old');

    await userEvent.click(screen.getByRole('button', { name: 'Newest' }));

    const titles = screen.getAllByRole('button', { name: /^Grab / }).map((button) => button.getAttribute('aria-label'));
    expect(titles).toEqual(['Grab New', 'Grab Old', 'Grab Unknown']);
  });

  it('shows only the top 100 for the sort, and says how many were found', async () => {
    answer({
      results: Array.from({ length: 150 }, (_, i) => ({ ...result(`r${i}`, `Release ${i}`, null), size: i })),
      total: 900,
    });
    setup();
    await userEvent.type(screen.getByRole('textbox'), 'bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Top 100 of 900')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Size' }));
    expect(screen.getAllByRole('button', { name: /^Grab / })[0].getAttribute('aria-label')).toBe('Grab Release 149');
    expect(screen.getAllByRole('button', { name: /^Grab / })).toHaveLength(100);
  });

  it('sends the type, ids and picked indexers from the options sheet', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Search options' }));
    // The sheet's TV type, not the TV category chip behind it.
    const sheet = within(await screen.findByRole('dialog'));
    await userEvent.click(sheet.getByRole('button', { name: 'TV' }));
    await userEvent.type(screen.getByLabelText('TVDB ID'), '81189');
    await userEvent.type(screen.getByLabelText('Season'), '2');
    await userEvent.click(await sheet.findByRole('button', { name: /Nyaa/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    // An id alone is enough to search.
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Big Buck Bunny');

    const sent = new URL(String(searches()[0][0]), 'http://x').searchParams;
    expect(sent.get('type')).toBe('tvsearch');
    expect(sent.get('tvdbId')).toBe('81189');
    expect(sent.get('season')).toBe('2');
    expect(sent.get('indexerIds')).toBe('1');
    expect(sent.get('categories')).toBeNull();
  });

  it('shows why the server refused a search', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => (String(url).startsWith('/api/prowlarr/indexers')
      ? new Response(JSON.stringify(indexers))
      : new Response(JSON.stringify({ error: 'An indexer you picked is gone or disabled. Pick again.' }), { status: 400 })));
    setup();
    await userEvent.type(screen.getByRole('textbox'), 'bunny');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText(/gone or disabled/)).toBeTruthy();
  });
});
