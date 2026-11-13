// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

import { WatchlistButton } from './watchlist-button';

let saved: boolean;
let calls: Array<{ url: string; method: string }>;

beforeEach(() => {
  saved = true;
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    if (url.startsWith('/api/watchlist/match')) return Response.json({ item: saved ? { id: 'w1', title: 'Film' } : null });
    if (url === '/api/watchlist/w1' && init?.method === 'DELETE') {
      saved = false;
      return Response.json({ ok: true });
    }
    if (url === '/api/watchlist/tags') return Response.json([]);
    return Response.json({});
  }));
});
afterEach(() => vi.unstubAllGlobals());

const draft = { source: 'TMDB' as const, externalId: '603', mediaType: 'movie' as const, title: 'Film' };

function renderButton(match?: Parameters<typeof WatchlistButton>[0]['match']) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WatchlistButton draft={draft} variant="icon" match={match} />
    </QueryClientProvider>,
  );
}

describe('WatchlistButton', () => {
  it('shows a saved title filled, and a tap offers to take it off instead of saving it again', async () => {
    renderButton({ mediaType: 'movie', tmdbId: 603, arr: [{ instanceId: 'rad-a', id: 5 }] });
    const button = await screen.findByRole('button', { name: 'On your watchlist' });
    expect(button.querySelector('svg')?.getAttribute('class')).toContain('fill-current');
    expect(calls[0].url).toBe('/api/watchlist/match?mediaType=movie&tmdbId=603&arr=rad-a%3A5');

    const user = userEvent.setup();
    await user.click(button);
    expect(screen.getByText('Film is on your watchlist.')).toBeTruthy();
    expect(screen.queryByText('Add to watchlist')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Remove from watchlist' }));
    expect(calls).toContainEqual({ url: '/api/watchlist/w1', method: 'DELETE' });
    // The bookmark asks again and shows it unsaved.
    await screen.findByRole('button', { name: 'Add to watchlist' });
  });

  it('opens Add to watchlist for a title not saved', async () => {
    saved = false;
    renderButton({ mediaType: 'movie', tmdbId: 603 });
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/watchlist/match'))).toBe(true));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add to watchlist' }));
    expect(screen.getByRole('dialog', { name: 'Add to watchlist' })).toBeTruthy();
  });

  it('does not ask without the title\'s ids, as on a grid of posters', () => {
    renderButton();
    expect(calls).toEqual([]);
    expect(screen.getByRole('button', { name: 'Add to watchlist' })).toBeTruthy();
  });
});
