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
vi.mock('@/components/hero-carousel', () => ({ HeroCarousel: () => null }));
// The sheet renders its content while open, so the draft controls can be read.
vi.mock('@/components/ui/sheet', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div data-testid="sheet">{children}</div> : null),
    SheetContent: Pass,
    SheetHeader: Pass,
    SheetTitle: Pass,
    SheetFooter: Pass,
  };
});
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
    // The search box's recent-search list.
    searchHistory: {},
    addSearchTerm: () => {},
    removeSearchTerm: () => {},
  }));
  return { DEFAULT_DISCOVER_FILTERS, useUIStore };
});

import { DEFAULT_DISCOVER_FILTERS, useUIStore } from '@/lib/store';
import { resetRouteViewStateForTests } from '@/lib/hooks/use-route-view-state';
import DiscoverPage from './discover-home';

class IntersectionObserverStub {
  observe() {}
  disconnect() {}
}

let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
  resetRouteViewStateForTests();
  window.history.replaceState(null, '');
  window.sessionStorage.clear();
  useUIStore.setState({ discoverContentType: 'all', discoverSort: 'trending', discoverSortDirection: 'desc', discoverFilters: DEFAULT_DISCOVER_FILTERS });
  mocks.search = new URLSearchParams();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

const genreChip = (name: string) => [...document.querySelectorAll('[data-testid="sheet"] button')].find((b) => b.textContent === name);
const active = (name: string) => genreChip(name)?.className.includes('border-primary') ?? false;

// Kept suppression (audit-w8 Batch B): while the filter sheet is open, its draft
// controls follow the committed filters if those change underneath it.
describe('Discover filter drafts', () => {
  it('re-syncs the open sheet when the committed filters change', async () => {
    await act(async () => root.render(<DiscoverPage />));
    const open = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Advanced filters')!;
    await act(async () => open.click());
    expect(genreChip('Horror')).toBeDefined();
    expect(active('Horror')).toBe(false);

    await act(async () => { useUIStore.setState({ discoverFilters: { ...DEFAULT_DISCOVER_FILTERS, genres: [27] } }); });

    expect(active('Horror')).toBe(true);
  });
});
