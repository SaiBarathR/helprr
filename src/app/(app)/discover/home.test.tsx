// @vitest-environment jsdom
// Characterization tests for the Discover home: the carousels, the browse grid
// and the filter sheet, with real queries over a stubbed fetch. Written before
// the page is split into smaller modules (Workstream 15).
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  caps: new Set<string>(),
  urls: [] as URL[],
  grid: (() => ({ items: [], page: 1, totalPages: 1 })) as (url: URL) => unknown,
  sections: (): Promise<unknown> | unknown => null,
  intersect: null as null | ((entries: Array<{ isIntersecting: boolean }>) => void),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.search, usePathname: () => '/discover' }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock('@/components/permission-provider', () => ({
  useCan: (cap: string) => mocks.caps.has(cap),
  useMe: () => ({ seerrConfigured: false }),
  hasCapability: () => false,
}));
vi.mock('@/components/seerr/requested-media-provider', () => ({ useRequestedMedia: () => ({ isRequested: () => false, markRequested: vi.fn() }) }));
vi.mock('@/components/seerr/seerr-request-modal', () => ({ SeerrRequestModal: () => null }));
vi.mock('@/components/watchlist/watchlist-button', () => ({ WatchlistButton: () => null }));
vi.mock('@/components/scheduled-alerts/scheduled-alert-dialog', () => ({ ScheduledAlertButton: () => null }));
vi.mock('@/hooks/use-is-mobile', () => ({ useIsMobile: () => true }));
vi.mock('@/components/hero-carousel', () => ({ HeroCarousel: ({ slides }: { slides: React.ReactNode[] }) => <div aria-label="Hero">{slides}</div> }));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div role="dialog" aria-label="Advanced Filters">{children}</div> : null),
  SheetContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  SheetFooter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, ...props }: { children: React.ReactNode; 'aria-label'?: string }) => <button type="button" aria-label={props['aria-label']}>{children}</button>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => <button type="button" role="menuitem" onClick={onSelect}>{children}</button>,
}));
type MockAction = { id: string; label: string; href?: string; onSelect?: () => void };
vi.mock('@/components/ui/quick-context-menu', () => ({
  QuickContextMenu: ({ children, label, actions }: { children: React.ReactNode; label: string; actions?: MockAction[] }) => (
    <>
      {children}
      <div role="group" aria-label={label}>
        {(actions ?? []).map((action) => (action.href
          ? <a key={action.id} href={action.href}>{action.label}</a>
          : <button key={action.id} type="button" onClick={action.onSelect}>{action.label}</button>))}
      </div>
    </>
  ),
}));
// A real (unpersisted) zustand store with just the Discover slice.
vi.mock('@/lib/store', async () => {
  const { create } = await import('zustand');
  const DEFAULT_DISCOVER_FILTERS = {
    genres: [], yearFrom: '', yearTo: '', runtimeMin: '', runtimeMax: '', language: '', region: 'US',
    ratingMin: '', ratingMax: '', voteCountMin: '', providers: [], networks: [], companies: [], releaseState: '',
  };
  const useUIStore = create<Record<string, unknown>>((set) => ({
    discoverContentType: 'all',
    setDiscoverContentType: (discoverContentType: string) => set({ discoverContentType }),
    discoverSort: 'trending',
    setDiscoverSort: (discoverSort: string) => set({ discoverSort }),
    discoverSortDirection: 'desc',
    setDiscoverSortDirection: (discoverSortDirection: string) => set({ discoverSortDirection }),
    discoverFilters: DEFAULT_DISCOVER_FILTERS,
    setDiscoverFilters: (discoverFilters: unknown) => set({ discoverFilters }),
    searchHistory: {},
    addSearchTerm: () => {},
    removeSearchTerm: () => {},
  }));
  return { DEFAULT_DISCOVER_FILTERS, useUIStore };
});

import { DEFAULT_DISCOVER_FILTERS, useUIStore } from '@/lib/store';
import { resetRouteViewStateForTests } from '@/lib/hooks/use-route-view-state';
import DiscoverHome from './discover-home';

const item = (tmdbId: number, title: string, extra: Record<string, unknown> = {}) => ({
  id: tmdbId, tmdbId, mediaType: 'movie', title, overview: '', posterPath: null, backdropPath: null, releaseDate: '2020-01-01',
  year: 2020, rating: 7.3, voteCount: 100, popularity: 1, genres: [], ...extra,
});
const SECTIONS = [
  { key: 'trending', title: 'Trending', type: 'media', mediaType: 'all', items: [
    item(1, 'Alpha', { backdropPath: '/a.jpg', genreNames: ['Drama'] }),
    item(2, 'Bravo Show', { mediaType: 'tv', backdropPath: '/b.jpg' }),
  ] },
  { key: 'popular_movies', title: 'Popular Movies', type: 'media', mediaType: 'movie', items: [
    item(3, 'Charlie', { library: { exists: true, id: 5, instanceId: 'rad-1', instances: [{ id: 5, instanceId: 'rad-1', instanceLabel: 'main' }] } }),
  ] },
  { key: 'genres_movie', title: 'Movie Genres', type: 'genre', mediaType: 'movie', items: [{ id: 27, name: 'Horror', type: 'movie' }] },
  { key: 'providers', title: 'Streaming', type: 'provider', mediaType: 'all', items: [{ id: 8, name: 'Netflix', logoPath: null, type: 'tv' }] },
];
const LAYOUT = { sections: [
  { id: 'popular_movies', type: 'builtin', label: 'Popular Movies', enabled: true },
  { id: 'eighties', type: 'custom', label: 'Eighties Horror', enabled: true, filters: { contentType: 'movie', sortBy: 'popular', sortOrder: 'desc', genres: [27], yearFrom: '1980', yearTo: '1989' } },
  { id: 'trending', type: 'builtin', label: 'Trending', enabled: true },
  { id: 'genres_movie', type: 'builtin', label: 'Movie Genres', enabled: true },
  { id: 'providers', type: 'builtin', label: 'Streaming', enabled: true },
  { id: 'off', type: 'custom', label: 'Hidden', enabled: false, filters: { contentType: 'all', sortBy: 'trending', sortOrder: 'desc' } },
] };
const META = {
  genres: [{ id: 27, name: 'Horror', type: 'movie' }, { id: 18, name: 'Drama', type: 'tv' }],
  providers: [{ id: 8, name: 'Netflix', logoPath: null, type: 'tv' }],
  networks: [{ id: 213, name: 'HBO' }], regions: [], languages: [], releaseStates: [],
};

class IntersectionObserverStub {
  constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { mocks.intersect = callback; }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.search = new URLSearchParams();
  mocks.caps = new Set(['movies.add']);
  mocks.urls = [];
  mocks.intersect = null;
  mocks.sections = () => ({ sections: SECTIONS });
  mocks.grid = () => ({ items: [item(40, 'Grid One'), item(41, 'Grid Two')], page: 1, totalPages: 1 });
  resetRouteViewStateForTests();
  window.history.replaceState(null, '');
  window.sessionStorage.clear();
  useUIStore.setState({ discoverContentType: 'all', discoverSort: 'trending', discoverSortDirection: 'desc', discoverFilters: { ...DEFAULT_DISCOVER_FILTERS } });
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(String(input), 'http://helprr.test');
    mocks.urls.push(url);
    if (url.pathname === '/api/discover/filters') return Response.json(META);
    if (url.pathname === '/api/settings/discover-layout') return Response.json(LAYOUT);
    if (url.pathname === '/api/discover' && url.searchParams.get('mode') === 'sections') return Response.json(await mocks.sections());
    if (url.pathname === '/api/discover' && url.searchParams.get('limit')) return Response.json({ items: [item(80, 'Delta Horror')] });
    if (url.pathname === '/api/discover') return Response.json(mocks.grid(url));
    return Response.json({});
  }));
});
afterEach(() => vi.unstubAllGlobals());

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><DiscoverHome /></QueryClientProvider>);
  return user;
}
const gridUrls = () => mocks.urls.filter((url) => url.pathname === '/api/discover' && !url.searchParams.has('limit') && url.searchParams.get('mode') !== 'sections');
const lastGrid = () => Object.fromEntries(gridUrls().at(-1)!.searchParams);
const sectionTitles = () => [...document.querySelectorAll('section h2')].map((heading) => heading.textContent);

describe('Discover home (characterization)', () => {
  it('shows the hero, then the carousels in the saved layout order with the custom one in place', async () => {
    renderHome();
    await waitFor(() => expect(sectionTitles()).toEqual(['Popular Movies', 'Eighties Horror', 'Trending', 'Movie Genres', 'Streaming']));
    const hero = screen.getByLabelText('Hero');
    expect([...hero.querySelectorAll('h2')].map((heading) => heading.textContent)).toEqual(['Alpha', 'Bravo Show']);
    expect(within(hero).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/discover/movie/1', '/discover/tv/2']);
    expect(screen.getByText('Delta Horror')).toBeTruthy();
    const custom = mocks.urls.find((url) => url.searchParams.has('limit'))!;
    expect(Object.fromEntries(custom.searchParams)).toEqual({
      mode: 'browse', page: '1', limit: expect.any(String), contentType: 'movie', sortBy: 'popular', sortOrder: 'desc', genres: '27', yearFrom: '1980', yearTo: '1989',
    });
    expect(screen.queryByText('Hidden')).toBeNull();
    expect(gridUrls()).toEqual([]);
  });

  it('opens a poster, its library copy, or the add page', async () => {
    const user = renderHome();
    await user.click((await screen.findAllByRole('button', { name: /^Alpha/ })).find((button) => !button.closest('[aria-label="Hero"]'))!);
    expect(mocks.push).toHaveBeenCalledWith('/discover/movie/1');
    expect(within(screen.getByRole('group', { name: 'Charlie actions' })).getByRole('link', { name: 'Open in library' }).getAttribute('href')).toBe('/movies/5?instance=rad-1');
    expect(within(screen.getAllByRole('group', { name: 'Alpha actions' })[0]).getByRole('link', { name: 'Add to Radarr' }).getAttribute('href')).toBe('/movies/add?term=Alpha&tmdbId=1');
    expect(within(screen.getAllByRole('group', { name: 'Bravo Show actions' })[0]).queryByRole('link', { name: /Add to/ })).toBeNull();
  });

  it("browses a carousel's section from See all, then clears the section and goes back home", async () => {
    const user = renderHome();
    await waitFor(() => expect(sectionTitles()).toContain('Popular Movies'));
    const popular = [...document.querySelectorAll('section')].find((section) => section.querySelector('h2')?.textContent === 'Popular Movies')!;
    await user.click(within(popular).getByRole('button', { name: 'See all' }));
    await waitFor(() => expect(gridUrls()).toHaveLength(1));
    expect(lastGrid()).toEqual(expect.objectContaining({ mode: 'browse', section: 'popular_movies', sortBy: 'popular', contentType: 'movie', sortOrder: 'desc' }));
    expect(await screen.findByText('Section: popular movies')).toBeTruthy();
    expect(screen.getByText('Grid One')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Clear section' }));
    await waitFor(() => expect(lastGrid().section).toBeUndefined());
    await user.click(screen.getByRole('button', { name: 'Back to Discover' }));
    await waitFor(() => expect(sectionTitles()).toContain('Trending'));
    expect(useUIStore.getState()).toEqual(expect.objectContaining({ discoverSort: 'trending', discoverContentType: 'all', discoverFilters: DEFAULT_DISCOVER_FILTERS }));
  });

  it("browses a custom carousel's filters from its See all", async () => {
    const user = renderHome();
    await waitFor(() => expect(sectionTitles()).toContain('Eighties Horror'));
    const custom = [...document.querySelectorAll('section')].find((section) => section.querySelector('h2')?.textContent === 'Eighties Horror')!;
    expect(within(custom).getByText('Custom')).toBeTruthy();
    await user.click(within(custom).getByRole('button', { name: 'See all' }));
    await waitFor(() => expect(gridUrls()).toHaveLength(1));
    expect(lastGrid()).toEqual(expect.objectContaining({ contentType: 'movie', sortBy: 'popular', sortOrder: 'desc', genres: '27', yearFrom: '1980', yearTo: '1989', region: 'US' }));
    expect(lastGrid().section).toBeUndefined();
  });

  it('browses a genre or provider tile', async () => {
    const user = renderHome();
    await user.click(await screen.findByRole('button', { name: 'Horror' }));
    await waitFor(() => expect(gridUrls()).toHaveLength(1));
    expect(lastGrid()).toEqual(expect.objectContaining({ genres: '27', contentType: 'movie' }));
    expect((useUIStore.getState().discoverFilters as { genres: number[] }).genres).toEqual([27]);

    await user.click(screen.getByRole('button', { name: 'Back to Discover' }));
    await user.click(await screen.findByRole('button', { name: 'Netflix' }));
    await waitFor(() => expect(lastGrid()).toEqual(expect.objectContaining({ providers: '8', contentType: 'show' })));
  });

  it('browses with a chosen content type or sort, and refreshes on choosing the active one', async () => {
    const user = renderHome();
    await waitFor(() => expect(sectionTitles()).toContain('Trending'));
    await user.click(screen.getByRole('menuitem', { name: 'Movies' }));
    await waitFor(() => expect(lastGrid()).toEqual(expect.objectContaining({ contentType: 'movie', sortBy: 'trending' })));
    expect(screen.getByText('Custom search and filters')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Highly Rated' }));
    await waitFor(() => expect(lastGrid()).toEqual(expect.objectContaining({ contentType: 'movie', sortBy: 'highlyRated' })));
    const before = gridUrls().length;
    await user.click(screen.getByRole('button', { name: 'Highly Rated' }));
    await waitFor(() => expect(gridUrls().length).toBe(before + 1));
  });

  it('applies the filter sheet, normalized, and resets its drafts', async () => {
    const user = renderHome();
    await waitFor(() => expect(sectionTitles()).toContain('Trending'));
    await user.click(screen.getByRole('button', { name: 'Advanced filters' }));
    const sheet = screen.getByRole('dialog', { name: 'Advanced Filters' });
    await user.click(within(sheet).getByRole('button', { name: 'Horror' }));
    await user.type(within(sheet).getByPlaceholderText('1995'), ' 1995 ');
    await user.type(within(sheet).getByPlaceholderText('7.5'), '7.50');
    await user.click(within(sheet).getByRole('button', { name: 'ended' }));
    await user.click(within(sheet).getByRole('button', { name: 'asc' }));
    await user.click(within(sheet).getByRole('button', { name: 'Apply' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUIStore.getState().discoverFilters).toEqual({ ...DEFAULT_DISCOVER_FILTERS, genres: [27], yearFrom: '1995', ratingMin: '7.5', releaseState: 'ended' });
    expect(useUIStore.getState().discoverSortDirection).toBe('asc');
    await waitFor(() => expect(lastGrid()).toEqual(expect.objectContaining({ genres: '27', yearFrom: '1995', ratingMin: '7.5', releaseState: 'ended', sortOrder: 'asc' })));
    expect(screen.getByRole('button', { name: 'Advanced filters' }).textContent).toBe('4');

    // Reopened, it starts from what was applied; Reset clears the drafts, and applying them goes home.
    await user.click(screen.getByRole('button', { name: 'Advanced filters' }));
    const again = screen.getByRole('dialog', { name: 'Advanced Filters' });
    expect((within(again).getByPlaceholderText('1995') as HTMLInputElement).value).toBe('1995');
    await user.click(within(again).getByRole('button', { name: 'Reset' }));
    expect((within(again).getByPlaceholderText('1995') as HTMLInputElement).value).toBe('');
    await user.click(within(again).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(sectionTitles()).toContain('Trending'));
  });

  it('stays on the results when the sheet is reset and applied while browsing a content type', async () => {
    const user = renderHome();
    await waitFor(() => expect(sectionTitles()).toContain('Trending'));
    await user.click(screen.getByRole('menuitem', { name: 'Movies' }));
    await waitFor(() => expect(lastGrid()).toEqual(expect.objectContaining({ contentType: 'movie' })));
    await user.click(screen.getByRole('button', { name: 'Advanced filters' }));
    const sheet = screen.getByRole('dialog', { name: 'Advanced Filters' });
    await user.click(within(sheet).getByRole('button', { name: 'Reset' }));
    await user.click(within(sheet).getByRole('button', { name: 'Apply' }));
    expect(screen.getByText('Discover Results')).toBeTruthy();
    expect(sectionTitles()).toEqual([]);
  });

  it('fetches the results again when only the sort direction changes', async () => {
    const user = renderHome();
    await user.click(await screen.findByRole('button', { name: 'Popular' }));
    await waitFor(() => expect(lastGrid()).toEqual(expect.objectContaining({ sortBy: 'popular', sortOrder: 'desc' })));
    const before = gridUrls().length;
    await user.click(screen.getByRole('button', { name: 'Advanced filters' }));
    const sheet = screen.getByRole('dialog', { name: 'Advanced Filters' });
    await user.click(within(sheet).getByRole('button', { name: 'asc' }));
    await user.click(within(sheet).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(gridUrls().length).toBe(before + 1));
    expect(lastGrid()).toEqual(expect.objectContaining({ sortBy: 'popular', sortOrder: 'asc' }));
  });

  it('loads the next page as the end of the grid comes into view, without repeating a title', async () => {
    mocks.grid = (url) => (url.searchParams.get('page') === '2'
      ? { items: [item(41, 'Grid Two'), item(42, 'Grid Three')], page: 2, totalPages: 2 }
      : { items: [item(40, 'Grid One'), item(41, 'Grid Two')], page: 1, totalPages: 2 });
    const user = renderHome();
    await user.click(await screen.findByRole('button', { name: 'Popular' }));
    await screen.findByText('Grid Two');
    await waitFor(() => expect(mocks.intersect).not.toBeNull());
    await act(async () => mocks.intersect!([{ isIntersecting: true }]));
    await screen.findByText('Grid Three');
    expect(screen.getAllByText('Grid Two')).toHaveLength(1);
    expect(gridUrls().map((url) => url.searchParams.get('page'))).toEqual(['1', '2']);
  });

  it('says when nothing matches, and Reset filters goes back home', async () => {
    mocks.grid = () => ({ items: [], page: 1, totalPages: 1 });
    const user = renderHome();
    await user.click(await screen.findByRole('button', { name: 'Popular' }));
    expect(await screen.findByText('No matches found')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));
    await waitFor(() => expect(sectionTitles()).toContain('Trending'));
  });

  it("shows a cast link's person over the movies it narrows, and drops them on request", async () => {
    mocks.search = new URLSearchParams('person=7&personName=Ana%20Lee');
    const user = renderHome();
    const banner = (await screen.findByText('Movies with Ana Lee')).parentElement!;
    expect(screen.getByText('Filtered by: Ana Lee')).toBeTruthy();
    await waitFor(() => expect(lastGrid()).toEqual(expect.objectContaining({ with_people: '7', contentType: 'movie' })));
    await user.click(within(banner).getByRole('button'));
    await waitFor(() => expect(screen.queryByText('Movies with Ana Lee')).toBeNull());
    await waitFor(() => expect(lastGrid().with_people).toBeUndefined());
  });

  it('shows the loading skeleton until the carousels arrive', async () => {
    let arrive!: (value: unknown) => void;
    mocks.sections = () => new Promise((resolve) => { arrive = resolve; });
    renderHome();
    expect(await screen.findByRole('status', { name: 'Loading Discover' })).toBeTruthy();
    await act(async () => arrive({ sections: SECTIONS }));
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading Discover' })).toBeNull());
    expect(sectionTitles()).toContain('Trending');
  });
});
