// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  caps: new Set<string>(),
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap), useMe: () => null }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ back: vi.fn(), push: mocks.push }) }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
import OrganizeTorrentsPage from './page';
import { setOrganizeTargets } from '../_components/organize-targets';

let posts: Record<string, unknown>[];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.caps = new Set(['torrents.manage']);
  posts = [];
  setOrganizeTargets([
    { hash: 'aaa', name: 'Alpha.Movie', save_path: '/data/movies', tags: '4k, movies' },
    { hash: 'bbb', name: 'Bravo.Show', save_path: '/data/tv', tags: 'movies' },
  ]);
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return Response.json({ tags: ['4k', 'movies', 'old'], queueingEnabled: true });
    posts.push(JSON.parse(String(init.body)));
    return Response.json({ success: true });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  setOrganizeTargets([]);
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><OrganizeTorrentsPage /></QueryClientProvider>);
  return userEvent.setup();
}

describe('location, tags and queue for the selected torrents', () => {
  it('shows mixed folders and how many of the torrents carry each tag', () => {
    renderPage();

    expect(screen.getByText('2 torrents')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Save Path\s*Mixed/ })).toBeTruthy();
    expect(screen.getByText('1 of 2')).toBeTruthy();
  });

  it('acts on every selected torrent at once', async () => {
    const user = renderPage();
    // On only one of them: offered again so it can go on both.
    await user.click(await screen.findByRole('button', { name: 'Add tag 4k' }));
    await waitFor(() => expect(screen.queryByText('1 of 2')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Remove tag movies' }));
    await user.click(screen.getByRole('button', { name: 'Move to the bottom of the queue' }));
    await user.click(screen.getByRole('button', { name: /Save Path/ }));
    await user.type(screen.getByRole('textbox', { name: 'Save Path' }), '/data/archive');
    await user.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Save Path\s*\/data\/archive/ })).toBeTruthy());

    expect(posts).toEqual([
      { hash: 'aaa|bbb', action: 'addTags', tags: ['4k'] },
      { hash: 'aaa|bbb', action: 'removeTags', tags: ['movies'] },
      { hash: 'aaa|bbb', action: 'bottomPrio' },
      { hash: 'aaa|bbb', action: 'setLocation', location: '/data/archive' },
    ]);
  });

  it('says so after a reload, when the selection is gone', () => {
    setOrganizeTargets([]);
    renderPage();

    expect(screen.getByText('No torrents selected.')).toBeTruthy();
  });

  it('changes nothing for someone who may not manage torrents', () => {
    mocks.caps = new Set();
    renderPage();

    expect(screen.getByText("You don't have permission to change torrents.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Save Path/ })).toBeNull();
  });
});
