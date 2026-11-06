// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionProvider, type MePayload } from '@/components/permission-provider';
import { useSearchPalette } from '@/components/search/search-store';
import type { SearchProviderResult, SearchResult } from '@/lib/search/types';

const push = vi.fn();
const isRequested = vi.fn((mediaType: 'movie' | 'tv', tmdbId: number) => mediaType === 'tv' && tmdbId === 90228);

vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push }) }));
vi.mock('@/lib/hooks/use-search-history', () => ({
  useSearchHistory: () => ({ recent: [], add: vi.fn(), remove: vi.fn() }),
}));
vi.mock('@/components/media/fade-in-image', () => ({ FadeInImage: () => null }));
vi.mock('@/components/seerr/requested-media-provider', () => ({
  useRequestedMedia: () => ({ isRequested, markRequested: vi.fn() }),
}));

import { CommandPaletteDialog } from '@/components/search/command-palette-dialog';

const ADMIN: MePayload = {
  id: 'u1',
  name: 'Admin',
  role: 'admin',
  template: 'admin',
  capabilities: {},
  seerrConfigured: true,
  tmdbConfigured: true,
  seerrUserId: null,
  jellyfinLinked: false,
  jellyfinConfigured: false,
  twitchConfigured: false,
  youtubeConfigured: false,
  jellyfinConnected: false,
  hasLocalPassword: true,
  customHeadersEnabled: false,
};

const MEMBER_NO_DISCOVER: MePayload = {
  ...ADMIN,
  id: 'u2',
  role: 'member',
  template: 'custom',
  capabilities: { 'movies.view': true, 'series.view': true, 'anime.view': true },
};

const MEMBER_LIBRARY_ONLY: MePayload = {
  ...MEMBER_NO_DISCOVER,
  capabilities: { 'movies.view': true, 'series.view': true },
};

const DUNE_LOCAL: SearchResult = {
  id: 'movies:1:1',
  title: 'Dune',
  year: 2021,
  poster: null,
  modules: [{ module: 'movies', route: '/movies/1' }],
  score: 1,
};

const TMDB_RESULTS: SearchProviderResult[] = [
  {
    id: 'tmdb:tv:90228',
    title: 'Dune: Prophecy',
    year: 2024,
    poster: null,
    route: '/discover/tv/90228',
    provider: 'tmdb',
    tmdb: { mediaType: 'tv', id: 90228 },
  },
  {
    id: 'tmdb:movie:438631',
    title: 'Dune',
    year: 2021,
    poster: null,
    route: '/discover/movie/438631',
    provider: 'tmdb',
    tmdb: { mediaType: 'movie', id: 438631 },
    badge: 'In library',
  },
  {
    id: 'tmdb:movie:841',
    title: 'Dune (1984)',
    year: 1984,
    poster: null,
    route: '/discover/movie/841',
    provider: 'tmdb',
    tmdb: { mediaType: 'movie', id: 841 },
  },
];

let localResults: SearchResult[] = [];
const fetchMock = vi.fn(async (input: string) => {
  const url = new URL(input, 'http://localhost');
  const body = url.pathname === '/api/search'
    ? { results: localResults, searched: [], degraded: [] }
    : { results: url.pathname === '/api/search/providers/tmdb' ? TMDB_RESULTS : [], searched: [], degraded: [] };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
});

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  localResults = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  useSearchPalette.setState({ open: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPalette(me: MePayload) {
  return render(
    <PermissionProvider value={me}>
      <CommandPaletteDialog />
    </PermissionProvider>
  );
}

async function typeQuery(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByRole('combobox'), text);
  return user;
}

describe('CommandPaletteDialog remote search', () => {
  it('offers TMDB and AniList after library matches', async () => {
    localResults = [DUNE_LOCAL];
    renderPalette(ADMIN);
    await typeQuery('dune');

    const group = await screen.findByRole('group', { name: 'Not in your library?' });
    const options = within(group).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Search TMDB for “dune”'),
      expect.stringContaining('Search AniList for “dune”'),
    ]);
    expect(screen.getByRole('option', { name: /Dune/ })).toBeTruthy();
  });

  it('opens TMDB scoped to the same query from the row', async () => {
    localResults = [DUNE_LOCAL];
    renderPalette(ADMIN);
    const user = await typeQuery('dune');

    await user.click(await screen.findByRole('option', { name: /Search TMDB for “dune”/ }));

    expect(screen.getByRole('button', { name: 'Clear TMDB scope' })).toBeTruthy();
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('dune');
    await screen.findByRole('option', { name: /Dune: Prophecy/ });
    expect(fetchMock).toHaveBeenCalledWith('/api/search/providers/tmdb?q=dune&limit=20', expect.anything());
  });

  it('lists remote scopes first and drops the library scopes it just searched when nothing matched', async () => {
    renderPalette(ADMIN);
    await typeQuery('dune');

    const group = await screen.findByRole('group', { name: 'Try searching in' });
    const labels = within(group).getAllByRole('option').map((o) => o.querySelector('.font-medium')?.textContent);
    expect(labels.slice(0, 2)).toEqual(['TMDB', 'AniList']);
    for (const local of ['TV Series', 'Movies', 'Music', 'Watchlist']) {
      expect(labels).not.toContain(local);
    }
    expect(screen.queryByRole('group', { name: 'Not in your library?' })).toBeNull();
  });

  it('keeps every fallback row reachable by keyboard when the query is also a scope alias', async () => {
    renderPalette(ADMIN);
    const user = await typeQuery('tm');

    await screen.findByRole('group', { name: 'Try searching in' });
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('AniList');
  });

  it('gives a member without discover access no TMDB row', async () => {
    localResults = [DUNE_LOCAL];
    renderPalette(MEMBER_NO_DISCOVER);
    await typeQuery('dune');

    const group = await screen.findByRole('group', { name: 'Not in your library?' });
    expect(within(group).getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('Search AniList for “dune”'),
    ]);
    expect(screen.queryByRole('option', { name: /TMDB/ })).toBeNull();
  });

  it('shows no empty scope list to a member who can only search the library', async () => {
    renderPalette(MEMBER_LIBRARY_ONLY);
    await typeQuery('dune');

    await screen.findByText(/No library matches found/);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('marks TMDB rows that are in the library or already requested', async () => {
    renderPalette(ADMIN);
    const user = await typeQuery('dune');
    await user.click(await screen.findByRole('option', { name: /Search TMDB for “dune”/ }));

    const prophecy = await screen.findByRole('option', { name: /Dune: Prophecy/ });
    expect(prophecy.textContent).toContain('Requested');
    const film = screen.getByText('Dune', { exact: true }).closest('[role="option"]')!;
    expect(film.textContent).toContain('In library');
    expect(film.textContent).not.toContain('Requested');
    const old = screen.getByRole('option', { name: /Dune \(1984\)/ });
    expect(old.textContent).not.toMatch(/Requested|In library/);
  });
});
