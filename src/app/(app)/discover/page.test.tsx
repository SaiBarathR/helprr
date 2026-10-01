// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: new URLSearchParams(),
  routerReplace: vi.fn(),
  gridKey: undefined as readonly unknown[] | undefined,
  meta: {
    genres: [{ id: 27, name: 'Horror', type: 'movie' }, { id: 18, name: 'Drama', type: 'movie' }],
    providers: [],
    networks: [],
    regions: [],
    languages: [],
    releaseStates: [],
  },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.search,
  usePathname: () => '/discover',
}));
vi.mock('@/components/layout/navigation-provider', () => ({
  useAppRouter: () => ({ push: vi.fn(), replace: mocks.routerReplace }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => ({
    data: queryKey[1] === 'filters' ? mocks.meta : undefined,
    isLoading: false,
    error: null,
    failureReason: null,
  }),
  useQueries: () => [],
}));
vi.mock('@/lib/hooks/use-restorable-infinite-query', () => ({
  useRestorableInfiniteQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    mocks.gridKey = queryKey;
    return {
      data: { pages: [] },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      error: null,
      failureReason: null,
    };
  },
}));
vi.mock('@/components/media/search-bar', () => ({ SearchBar: () => null }));
vi.mock('@/components/hero-carousel', () => ({ HeroCarousel: () => null }));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: () => null,
  SheetContent: () => null,
  SheetHeader: () => null,
  SheetTitle: () => null,
  SheetFooter: () => null,
}));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: () => null,
  DropdownMenuTrigger: () => null,
  DropdownMenuContent: () => null,
  DropdownMenuItem: () => null,
}));
vi.mock('@/hooks/use-is-mobile', () => ({ useIsMobile: () => true }));
vi.mock('@/components/permission-provider', () => ({
  useCan: () => false,
  useMe: () => null,
  hasCapability: () => false,
}));
vi.mock('@/components/seerr/requested-media-provider', () => ({
  useRequestedMedia: () => ({ isRequested: false, markRequested: vi.fn() }),
}));
vi.mock('@/components/seerr/seerr-request-modal', () => ({ SeerrRequestModal: () => null }));
// A real (unpersisted) zustand store with just the Discover slice, so the page
// re-renders on writes exactly as it does against the app store.
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
  }));
  return { DEFAULT_DISCOVER_FILTERS, useUIStore };
});

import { DEFAULT_DISCOVER_FILTERS, useUIStore } from '@/lib/store';
import { resetRouteViewStateForTests } from '@/lib/hooks/use-route-view-state';
import DiscoverPage from './page';

const SAVED = {
  discoverContentType: 'show' as const,
  discoverSort: 'popular',
  discoverSortDirection: 'desc' as const,
  discoverFilters: { ...DEFAULT_DISCOVER_FILTERS, genres: [18] },
};

class IntersectionObserverStub {
  observe() {}
  disconnect() {}
}

let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
  mocks.routerReplace.mockClear();
  mocks.gridKey = undefined;
  resetRouteViewStateForTests();
  window.sessionStorage.clear();
  useUIStore.setState(SAVED);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function open(query: string) {
  mocks.search = new URLSearchParams(query);
  await act(async () => root.render(<DiscoverPage />));
}

async function click(label: string) {
  const target = [...document.querySelectorAll('button')].find(
    (el) => el.getAttribute('aria-label') === label || el.textContent === label,
  );
  if (!target) throw new Error(`No button "${label}"`);
  await act(async () => target.click());
}

const grid = () => mocks.gridKey?.[2] as { contentType: string; sort: string; filters: { genres: number[] } };
const saved = () => {
  const { discoverContentType, discoverSort, discoverSortDirection, discoverFilters } = useUIStore.getState();
  return { discoverContentType, discoverSort, discoverSortDirection, discoverFilters };
};

describe('Discover links', () => {
  it('browses a link on its own, without the saved filters', async () => {
    await open('genres=27&contentType=movie');

    expect(grid()).toMatchObject({ contentType: 'movie', sort: 'popular', filters: { genres: [27] } });
    expect(document.body.textContent).toContain('Horror');
    expect(document.body.textContent).not.toContain('Drama');
    expect(saved()).toEqual(SAVED);
  });

  it("keeps changes made on a link's view with that link", async () => {
    await open('genres=27&contentType=movie');

    await click('Highly Rated');
    expect(grid()).toMatchObject({ sort: 'highlyRated', filters: { genres: [27] } });
    await click('Remove Horror filter');
    expect(grid()).toMatchObject({ sort: 'highlyRated', filters: { genres: [] } });
    expect(saved()).toEqual(SAVED);
  });

  it("restores a link's changes when it is visited again", async () => {
    await open('genres=27&contentType=movie');
    await click('Highly Rated');
    await act(async () => root.unmount());

    root = createRoot(document.getElementById('root')!);
    await open('genres=27&contentType=movie');
    expect(grid()).toMatchObject({ sort: 'highlyRated', filters: { genres: [27] } });
  });

  it('leaves a link for the saved Discover instead of resetting it', async () => {
    await open('companies=41077&companyName=A24&contentType=movie');
    expect(document.body.textContent).toContain('A24');

    await click('Back to Discover');
    expect(mocks.routerReplace).toHaveBeenCalledWith('/discover');
    expect(saved()).toEqual(SAVED);
  });

  it('shows saved filters on a plain visit and saves changes made there', async () => {
    await open('');
    expect(grid()).toMatchObject({ contentType: 'show', sort: 'popular', filters: { genres: [18] } });
    expect(document.body.textContent).toContain('Drama');

    await click('Remove Drama filter');
    expect(saved().discoverFilters).toEqual({ ...DEFAULT_DISCOVER_FILTERS, genres: [] });
    expect(grid()).toMatchObject({ filters: { genres: [] } });
  });

  it('opens a plain visit on the home carousels after a grid-only browse', async () => {
    useUIStore.setState({
      discoverContentType: 'all',
      discoverSort: 'trending',
      discoverSortDirection: 'desc',
      discoverFilters: DEFAULT_DISCOVER_FILTERS,
    });
    // Left by a cleared search on an earlier plain visit in this tab.
    window.sessionStorage.setItem('helprr:route-views:v1', JSON.stringify([['/discover?', { manualBrowseMode: true }]]));
    await open('');

    expect(document.body.textContent).not.toContain('Discover Results');
  });
});
