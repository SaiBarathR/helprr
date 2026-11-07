// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const search = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search.value) }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

import { WatchlistFocusDialog } from './watchlist-focus-dialog';

const dune = { id: 'w1', title: 'Dune', year: 2021, href: '/movies/12?instance=radarr-main' };

function open(focus: string, props: Partial<Parameters<typeof WatchlistFocusDialog>[0]> = {}) {
  search.value = `focus=${focus}`;
  window.history.replaceState(null, '', `/watchlist?focus=${focus}`);
  const onRemove = vi.fn(async () => undefined);
  render(<WatchlistFocusDialog items={[dune]} canEdit removing={false} onRemove={onRemove} {...props} />);
  return { onRemove };
}

beforeEach(() => {
  search.value = '';
});

// The iOS fallback for the push's Remove button: its tap opens /watchlist?focus=<id>.
describe('the watchlist focus link', () => {
  it('offers Open and Remove for the pushed title, and drops the focus from the URL', async () => {
    const { onRemove } = open('w1');
    expect(await screen.findByText('Now in your library')).toBeTruthy();
    expect(screen.getByText('Dune (2021) from your watchlist is ready to watch.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/movies/12?instance=radarr-main');
    expect(window.location.search).toBe('');

    await userEvent.click(screen.getByRole('button', { name: 'Remove from watchlist' }));
    expect(onRemove).toHaveBeenCalledWith(dune);
  });

  it('waits for the list before deciding', () => {
    open('w1', { items: null });
    expect(screen.queryByText('Now in your library')).toBeNull();
    expect(window.location.search).toBe('?focus=w1');
  });

  it('shows nothing for an item that is no longer on the watchlist', () => {
    open('gone');
    expect(screen.queryByText('Now in your library')).toBeNull();
  });

  it('has no Remove for someone who may not edit the watchlist', async () => {
    open('w1', { canEdit: false });
    expect(await screen.findByText('Now in your library')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove from watchlist' })).toBeNull();
  });
});
