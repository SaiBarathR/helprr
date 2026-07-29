// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface InfiniteResult {
  data: { pages: { items: { id: number }[]; pageInfo: null }[] } | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  hasNextPage: boolean;
  refetch: ReturnType<typeof vi.fn>;
  fetchNextPage: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  browseQuery: undefined as InfiniteResult | undefined,
  searchQuery: undefined as InfiniteResult | undefined,
  searchParams: new URLSearchParams(),
  routerReplace: vi.fn(),
  setAnimeSort: vi.fn(),
  setAnimeFilters: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: ({ queryKey }: { queryKey: readonly unknown[] }) =>
    queryKey[2] === 'browse' ? mocks.browseQuery : mocks.searchQuery,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/anime/explore',
  useRouter: () => ({ replace: mocks.routerReplace }),
  useSearchParams: () => mocks.searchParams,
}));
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/anime/anime-card', () => ({
  AnimeCard: ({ item }: { item: { id: number } }) => `Anime ${item.id}`,
}));
vi.mock('@/components/media/search-bar', () => ({
  SearchBar: () => null,
}));
vi.mock('@/components/ui/page-spinner', () => ({
  PageSpinner: () => 'Loading',
}));
vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ children }: { children: React.ReactNode }) => children,
  DrawerContent: () => null,
  DrawerFooter: () => null,
  DrawerHeader: () => null,
  DrawerTitle: () => null,
}));
vi.mock('@/lib/media-list-cache', () => ({
  getListViewState: () => null,
  setListViewState: vi.fn(),
}));
vi.mock('@/lib/store', () => {
  const filters = {
    genres: [],
    year: '',
    yearMin: '',
    yearMax: '',
    season: '',
    formats: [],
    status: '',
  };
  const state = {
    animeSort: 'seasonal',
    setAnimeSort: mocks.setAnimeSort,
    animeFilters: filters,
    setAnimeFilters: mocks.setAnimeFilters,
    hasHydrated: true,
  };
  return {
    DEFAULT_ANIME_FILTERS: filters,
    useUIStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

import AnimePage from './page';

class IntersectionObserverStub {
  observe() {}
  disconnect() {}
}

let root: Root;

function infiniteResult(overrides: Partial<InfiniteResult> = {}): InfiniteResult {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    hasNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
  mocks.searchParams = new URLSearchParams();
  mocks.browseQuery = infiniteResult();
  mocks.searchQuery = infiniteResult();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderPage() {
  await act(async () => {
    root.render(createElement(AnimePage));
  });
}

describe('Anime Explore query states', () => {
  it('renders a retryable initial error instead of an empty result', async () => {
    mocks.browseQuery = infiniteResult({ isError: true });
    await renderPage();

    expect(document.body.textContent).toContain("Couldn't load anime. Try again.");
    expect(document.body.textContent).not.toContain('No results found');

    const retry = [...document.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Retry'));
    await act(async () => retry?.click());
    expect(mocks.browseQuery.refetch).toHaveBeenCalledOnce();
  });

  it('preserves the successful empty state', async () => {
    mocks.browseQuery = infiniteResult({
      data: { pages: [{ items: [], pageInfo: null }] },
    });
    await renderPage();

    expect(document.body.textContent).toContain('No results found');
  });

  it('keeps cached items visible after a background-refetch failure', async () => {
    mocks.browseQuery = infiniteResult({
      data: { pages: [{ items: [{ id: 1 }], pageInfo: null }] },
      isError: true,
    });
    await renderPage();

    expect(document.body.textContent).toContain('Anime 1');
    expect(document.body.textContent).not.toContain("Couldn't load anime");
  });

  it('preserves loaded items and retries a failed next page', async () => {
    mocks.browseQuery = infiniteResult({
      data: { pages: [{ items: [{ id: 1 }], pageInfo: null }] },
      hasNextPage: true,
      isError: true,
      isFetchNextPageError: true,
    });
    await renderPage();

    expect(document.body.textContent).toContain('Anime 1');
    expect(document.body.textContent).toContain("Couldn't load more results.");

    const retry = [...document.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Retry'));
    await act(async () => retry?.click());
    expect(mocks.browseQuery.fetchNextPage).toHaveBeenCalledOnce();
  });

  it("does not show an inactive browse query's error while search is active", async () => {
    vi.useFakeTimers();
    mocks.searchParams = new URLSearchParams('search=naruto');
    mocks.browseQuery = infiniteResult({ isError: true });
    mocks.searchQuery = infiniteResult({
      data: { pages: [{ items: [{ id: 2 }], pageInfo: null }] },
    });

    await renderPage();
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(document.body.textContent).toContain('Anime 2');
    expect(document.body.textContent).not.toContain("Couldn't load anime");
  });
});
