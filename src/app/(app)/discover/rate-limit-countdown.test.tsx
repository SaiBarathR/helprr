// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sectionsError: null as unknown,
  sectionsQueryFn: null as null | ((ctx: { signal?: AbortSignal }) => Promise<unknown>),
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
  useQuery: ({ queryKey, queryFn }: { queryKey: readonly unknown[]; queryFn: (ctx: { signal?: AbortSignal }) => Promise<unknown> }) => {
    if (queryKey[1] === 'sections') {
      mocks.sectionsQueryFn = queryFn;
      return { data: undefined, isLoading: false, error: mocks.sectionsError, failureReason: null };
    }
    return { data: queryKey[1] === 'filters' ? mocks.meta : undefined, isLoading: false, error: null, failureReason: null };
  },
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
    // The search box's recent-search list.
    searchHistory: {},
    addSearchTerm: () => {},
    removeSearchTerm: () => {},
  }));
  return { DEFAULT_DISCOVER_FILTERS, useUIStore };
});

import DiscoverPage from './discover-home';

class IntersectionObserverStub {
  observe() {}
  disconnect() {}
}

let root: Root;
const render = () => act(async () => root.render(<DiscoverPage />));
const banner = () => document.body.textContent ?? '';

/** The page's own rate-limit error, made by its query function from a 429. */
async function rateLimitError(body: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 429 })));
  return mocks.sectionsQueryFn!({}).then(() => { throw new Error('expected a rate limit'); }, (error: unknown) => error);
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
  mocks.sectionsError = null;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Kept suppression (audit-w8 Batch B): the countdown starts from each new
// retry-after value and is cleared when a rate limit carries none, so a stale
// countdown is never shown for a later limit.
describe('Discover rate-limit countdown', () => {
  it('counts down from the retry-after, and drops the countdown for a limit without one', async () => {
    await render();
    const withRetry = await rateLimitError({ error: 'TMDB rate limit reached', retryAfterSeconds: 30 });
    const withoutRetry = await rateLimitError({ error: 'TMDB rate limit reached' });

    mocks.sectionsError = withRetry;
    await render();
    expect(banner()).toContain('Please wait 30s before retrying.');
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(banner()).toContain('Please wait 25s before retrying.');

    mocks.sectionsError = withoutRetry;
    await render();
    expect(banner()).not.toContain('Please wait 25s');
    expect(banner()).toContain('TMDB rate limit reached. Please wait and try again.');
  });
});
