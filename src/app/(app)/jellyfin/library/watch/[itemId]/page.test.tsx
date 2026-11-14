// @vitest-environment jsdom
// A direct watch link opened by a member with no Jellyfin account linked used
// to end on "Couldn't start playback." with a Retry that could never help.
import { Suspense } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  playItem: vi.fn(async () => {}),
  replace: vi.fn(),
  refresh: vi.fn(),
  linked: false,
  catalogStatus: 200,
}));
vi.mock('@/components/layout/navigation-provider', () => ({
  useAppRouter: () => ({ push: vi.fn(), replace: mocks.replace, back: vi.fn(), refresh: mocks.refresh }),
}));
vi.mock('@/components/jellyfin-streaming/playback-provider', () => ({
  useJellyfinPlaybackState: () => ({ playItem: mocks.playItem, status: 'idle' }),
}));
vi.mock('@/components/jellyfin-streaming/watch-top-bar', () => ({
  WatchTopBar: () => <button type="button" aria-label="Go back" />,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import WatchPage from './page';

const item = { Id: 'abc123', Name: 'Dune', Type: 'Movie' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.linked = false;
  mocks.catalogStatus = 200;
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), 'http://helprr.test');
    if (url.pathname === '/api/account/jellyfin/link' && init?.method === 'POST') {
      mocks.linked = true;
      return Response.json({ connected: true, jellyfinUsername: 'sam' });
    }
    if (url.pathname === '/api/jellyfin/catalog/items/abc123') {
      if (mocks.catalogStatus !== 200) return Response.json({ error: 'nope' }, { status: mocks.catalogStatus });
      return Response.json(mocks.linked ? { linked: true, item } : { linked: false, item: null });
    }
    return Response.json({});
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <Suspense fallback={null}><WatchPage params={Promise.resolve({ itemId: 'abc123' })} /></Suspense>
      </QueryClientProvider>,
    );
  });
}

describe('watch page', () => {
  it('shows the Connect form with a way back to an unlinked member, then plays once connected', async () => {
    const user = userEvent.setup();
    await renderPage();
    expect(await screen.findByText('Connect your Jellyfin account')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();

    await user.type(screen.getByPlaceholderText('Jellyfin username'), 'sam');
    await user.type(screen.getByPlaceholderText('Jellyfin password'), 'secret-password');
    await user.click(screen.getByRole('button', { name: 'Connect Jellyfin account' }));

    await waitFor(() => expect(mocks.playItem).toHaveBeenCalledWith(expect.objectContaining({ Id: 'abc123' })));
    expect(mocks.replace).toHaveBeenCalledWith('/jellyfin/library/item/abc123');
  });

  it('offers Retry for an outage, under the Watch chrome', async () => {
    mocks.catalogStatus = 502;
    await renderPage();
    expect(await screen.findByText("Couldn't start playback.")).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeTruthy();
  });

  it('drops Retry when the answer is a refusal', async () => {
    mocks.catalogStatus = 403;
    await renderPage();
    expect(await screen.findByText("Couldn't start playback.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
  });
});
