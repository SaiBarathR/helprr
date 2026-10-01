// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({ search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.search,
  usePathname: () => '/activity',
}));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('@/components/layout/badge-provider', () => ({ useBadgeActions: () => ({ adjustBadge: vi.fn() }) }));
vi.mock('@/lib/client-refresh-settings', () => ({ getRefreshIntervalMs: vi.fn().mockResolvedValue(60_000) }));
// A real (unpersisted) zustand store with just the Activity slice, so the page
// re-renders on writes exactly as it does against the app store.
vi.mock('@/lib/store', async () => {
  const { create } = await import('zustand');
  const useUIStore = create<Record<string, unknown>>((set) => ({
    hasHydrated: true,
    activityTab: 'queue',
    setActivityTab: (activityTab: string) => set({ activityTab }),
    activitySortBy: 'progress',
    setActivitySortBy: (activitySortBy: string) => set({ activitySortBy }),
    activitySortDirection: 'desc',
    setActivitySortDirection: (activitySortDirection: string) => set({ activitySortDirection }),
    activityFilterBy: [],
    setActivityFilterBy: (activityFilterBy: string[]) => set({ activityFilterBy }),
    activityInstanceFilter: 'all',
    setActivityInstanceFilter: (activityInstanceFilter: string) => set({ activityInstanceFilter }),
  }));
  return { useUIStore };
});
import { useUIStore } from '@/lib/store';
import ActivityPage from './page';

const QUEUE = [
  { id: 1, title: 'Show.S01E01', source: 'sonarr', instanceId: 'son-1', downloadId: 'a', size: 100, sizeleft: 50, status: 'downloading', trackedDownloadState: 'downloading' },
  { id: 2, title: 'Movie.2026', source: 'radarr', instanceId: 'rad-1', downloadId: 'b', size: 100, sizeleft: 50, status: 'downloading', trackedDownloadState: 'downloading' },
];
const INSTANCES = [
  { id: 'son-1', label: 'main', type: 'SONARR' },
  { id: 'rad-1', label: 'main', type: 'RADARR' },
];

let root: Root;
let queryClient: QueryClient;
const initialStore = useUIStore.getState();

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useUIStore.setState(initialStore, true);
  mocks.search = new URLSearchParams();
  window.history.replaceState(null, '', '/activity');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/activity/queue') return Response.json({ records: QUEUE });
    if (url === '/api/instances') return Response.json(INSTANCES);
    return Response.json({});
  }));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  vi.unstubAllGlobals();
});

const wait = (ms: number) => act(async () => { await new Promise((done) => setTimeout(done, ms)); });
async function waitFor(check: () => void, timeout = 3000) {
  for (const start = Date.now(); ; await wait(10)) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() - start > timeout) throw error;
    }
  }
}
async function renderPage() {
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider><ActivityPage /></TooltipProvider>
    </QueryClientProvider>,
  ));
}
const text = () => document.body.textContent ?? '';
const filterBar = () => document.querySelector('[aria-label="Active filters"]');
const button = (name: string) =>
  [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name);

describe('Activity source filter', () => {
  it('shows every source with no filter bar when nothing is filtered', async () => {
    await renderPage();
    await waitFor(() => expect(text()).toContain('2 Tasks'));
    expect(filterBar()).toBeNull();
  });

  it('filters a ?source deep link for that visit without saving it', async () => {
    // Push notifications for a Sonarr grab open /activity?tab=queue&source=sonarr.
    mocks.search = new URLSearchParams('tab=queue&source=sonarr');
    window.history.replaceState(null, '', '/activity?tab=queue&source=sonarr');
    await renderPage();
    await waitFor(() => expect(text()).toContain('1 Task'));
    expect(filterBar()?.textContent).toContain('Sonarr');
    // The saved filter stays "All", so the next normal visit shows everything.
    expect(useUIStore.getState().activityFilterBy).toEqual([]);
  });

  it('clears a deep-link filter from the bar and drops it from the URL', async () => {
    mocks.search = new URLSearchParams('tab=queue&source=sonarr');
    window.history.replaceState(null, '', '/activity?tab=queue&source=sonarr');
    await renderPage();
    await waitFor(() => expect(text()).toContain('1 Task'));
    await act(async () => button('Remove Sonarr filter')!.click());
    await waitFor(() => expect(text()).toContain('2 Tasks'));
    expect(filterBar()).toBeNull();
    expect(window.location.search).toBe('?tab=queue');
  });

  it('falls back to the saved filter when a deep-link filter is dismissed', async () => {
    useUIStore.setState({ activityFilterBy: ['radarr'] });
    mocks.search = new URLSearchParams('tab=queue&source=sonarr');
    window.history.replaceState(null, '', '/activity?tab=queue&source=sonarr');
    await renderPage();
    await waitFor(() => expect(filterBar()?.textContent).toContain('Sonarr'));
    await act(async () => button('Remove Sonarr filter')!.click());
    await waitFor(() => expect(filterBar()?.textContent).toContain('Radarr'));
    expect(text()).toContain('1 Task');
    expect(useUIStore.getState().activityFilterBy).toEqual(['radarr']);
    expect(window.location.search).toBe('?tab=queue');
  });

  it('flags a saved source and instance filter and clears both at once', async () => {
    useUIStore.setState({ activityFilterBy: ['sonarr'], activityInstanceFilter: 'son-1' });
    await renderPage();
    await waitFor(() => expect(filterBar()?.textContent).toContain('main (Sonarr)'));
    expect(filterBar()?.textContent).toContain('Sonarr');
    expect(document.querySelector('[aria-label="Filter and sort (filters active)"]')).not.toBeNull();
    await act(async () => button('Clear all')!.click());
    await waitFor(() => expect(text()).toContain('2 Tasks'));
    expect(useUIStore.getState().activityFilterBy).toEqual([]);
    expect(useUIStore.getState().activityInstanceFilter).toBe('all');
    expect(filterBar()).toBeNull();
  });
});

// jsdom has no layout, so this pins the declarations that let a tall detail
// drawer scroll: the body is the drawer's flexible, scrollable child.
describe('Activity queue detail drawer', () => {
  it('scrolls its body so rows below the fold stay reachable', async () => {
    await renderPage();
    await waitFor(() => expect(text()).toContain('2 Tasks'));
    const row = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Show.S01E01'))!;
    await act(async () => row.click());
    await waitFor(() => expect(text()).toContain('Size Left'));
    const sizeLeft = [...document.querySelectorAll('span, p, div')].find((el) => el.textContent === 'Size Left')!;
    const body = sizeLeft.closest('.overflow-y-auto');
    expect(body?.className).toContain('min-h-0');
    expect(body?.className).toContain('flex-1');
  });
});
