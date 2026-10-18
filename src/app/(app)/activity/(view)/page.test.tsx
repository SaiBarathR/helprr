// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({ search: new URLSearchParams(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.search,
  usePathname: () => '/activity',
}));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: mocks.push, back: vi.fn() }) }));
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
import { resetPendingImportsForTests, trackManualImport } from '@/lib/manual-import-tracker';
import ActivityPage from './page';

const QUEUE = [
  { id: 1, title: 'Show.S01E01', source: 'sonarr', instanceId: 'son-1', downloadId: 'a', size: 100, sizeleft: 50, status: 'downloading', trackedDownloadState: 'downloading' },
  { id: 2, title: 'Movie.2026', source: 'radarr', instanceId: 'rad-1', downloadId: 'b', size: 100, sizeleft: 50, status: 'downloading', trackedDownloadState: 'downloading' },
];
// A TBA-titled episode Sonarr won't import on its own: it needs a manual import.
const BLOCKED = {
  id: 3, title: 'Show.S01E02', source: 'sonarr', instanceId: 'son-1', downloadId: 'c', size: 100, sizeleft: 0,
  status: 'completed', trackedDownloadState: 'importPending', trackedDownloadStatus: 'warning', seriesId: 9,
  statusMessages: [{ title: 'Show.S01E02.mkv', messages: ['Episode has a TBA title and recently aired'] }],
};
let queueRecords: unknown[] = QUEUE;
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
  mocks.push.mockClear();
  queueRecords = QUEUE;
  resetPendingImportsForTests();
  window.history.replaceState(null, '', '/activity');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/activity/queue') return Response.json({ records: queueRecords });
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
  [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name);

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

  it("keeps changes made on a link's view with the link instead of saving them", async () => {
    mocks.search = new URLSearchParams('tab=queue&source=sonarr,radarr');
    window.history.replaceState(null, '', '/activity?tab=queue&source=sonarr,radarr');
    await renderPage();
    await waitFor(() => expect(text()).toContain('2 Tasks'));
    await act(async () => button('Remove Sonarr filter')!.click());
    await waitFor(() => expect(text()).toContain('1 Task'));
    expect(filterBar()?.textContent).toContain('Radarr');
    expect(new URLSearchParams(window.location.search).get('source')).toBe('radarr');
    expect(useUIStore.getState().activityFilterBy).toEqual([]);
  });

  it('starts a link from every instance rather than the saved one', async () => {
    useUIStore.setState({ activityInstanceFilter: 'son-1' });
    mocks.search = new URLSearchParams('tab=queue&source=radarr');
    window.history.replaceState(null, '', '/activity?tab=queue&source=radarr');
    await renderPage();
    await waitFor(() => expect(text()).toContain('1 Task'));
    expect(filterBar()?.textContent).not.toContain('main');
    expect(useUIStore.getState().activityInstanceFilter).toBe('son-1');
  });

  it("clears a link's filters for the visit without touching the saved ones", async () => {
    useUIStore.setState({ activityFilterBy: ['radarr'], activityInstanceFilter: 'rad-1' });
    mocks.search = new URLSearchParams('tab=queue&source=sonarr,radarr&instance=son-1');
    window.history.replaceState(null, '', '/activity?tab=queue&source=sonarr,radarr&instance=son-1');
    await renderPage();
    await waitFor(() => expect(filterBar()?.textContent).toContain('main (Sonarr)'));
    await act(async () => button('Clear all')!.click());
    await waitFor(() => expect(text()).toContain('2 Tasks'));
    expect(filterBar()).toBeNull();
    expect(new URLSearchParams(window.location.search).get('source')).toBe('all');
    expect(useUIStore.getState().activityFilterBy).toEqual(['radarr']);
    expect(useUIStore.getState().activityInstanceFilter).toBe('rad-1');
  });

  it('keeps a link view change through a tab switch made right after it', async () => {
    mocks.search = new URLSearchParams('tab=queue&source=sonarr,radarr');
    window.history.replaceState(null, '', '/activity?tab=queue&source=sonarr,radarr');
    await renderPage();
    await waitFor(() => expect(text()).toContain('2 Tasks'));
    await act(async () => button('Remove Sonarr filter')!.click());
    // useSearchParams still holds the link as it was opened.
    const failedTab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.includes('Failed'))!;
    await act(async () => failedTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    const params = new URLSearchParams(window.location.search);
    expect(params.get('tab')).toBe('failed');
    expect(params.get('source')).toBe('radarr');
  });

  it('treats a link instance that no longer exists as every instance', async () => {
    mocks.search = new URLSearchParams('tab=queue&source=sonarr,radarr&instance=gone');
    window.history.replaceState(null, '', '/activity?tab=queue&source=sonarr,radarr&instance=gone');
    await renderPage();
    await waitFor(() => expect(text()).toContain('2 Tasks'));
    expect(filterBar()?.textContent).not.toContain('Instance');
  });

  it('drops a deep-link filter when the page navigates to plain /activity', async () => {
    mocks.search = new URLSearchParams('tab=queue&source=sonarr');
    window.history.replaceState(null, '', '/activity?tab=queue&source=sonarr');
    await renderPage();
    await waitFor(() => expect(text()).toContain('1 Task'));
    // A client navigation (e.g. the nav item) keeps the page mounted and only
    // changes the search params.
    mocks.search = new URLSearchParams();
    window.history.replaceState(null, '', '/activity');
    await renderPage();
    await waitFor(() => expect(text()).toContain('2 Tasks'));
    expect(filterBar()).toBeNull();
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

describe('Activity manual import from the queue', () => {
  it('offers Import on a queue item that needs a manual import', async () => {
    queueRecords = [...QUEUE, BLOCKED];
    await renderPage();
    await waitFor(() => expect(text()).toContain('MANUAL IMPORT'));
    expect(text()).toContain('Episode has a TBA title and recently aired');

    await act(async () => button('Import')!.click());
    const href = mocks.push.mock.calls[0]?.[0] as string;
    expect(href.startsWith('/activity/import?')).toBe(true);
    expect(new URLSearchParams(href.split('?')[1]).get('downloadId')).toBe('c');
  });

  it('lists a download the arr could not match to a series and offers Import for it', async () => {
    // What Sonarr returns for a torrent added by hand into its category: no series, no episode.
    const unmatched = {
      id: 4, title: '[grp] Some Show 3rd Season (BD 1080p)', source: 'sonarr', instanceId: 'son-1', downloadId: 'D', size: 100, sizeleft: 0,
      status: 'completed', trackedDownloadState: 'importBlocked', trackedDownloadStatus: 'warning',
      seriesId: null, episodeId: null, seasonNumber: null, series: null, episode: null, indexer: null,
      statusMessages: [{ title: '[grp] Some Show 3rd Season (BD 1080p)', messages: ['Series title mismatch; automatic import is not possible.'] }],
    };
    queueRecords = [...QUEUE, unmatched];
    await renderPage();
    await waitFor(() => expect(text()).toContain('[grp] Some Show 3rd Season (BD 1080p)'));
    expect(text()).toContain('MANUAL IMPORT');
    expect(text()).toContain('Series title mismatch');

    await act(async () => button('Import')!.click());
    const params = new URLSearchParams((mocks.push.mock.calls[0]?.[0] as string).split('?')[1]);
    expect(params.get('downloadId')).toBe('D');
    expect(params.get('instanceId')).toBe('son-1');
    // No series on the queue record: the import page takes it from the files instead.
    expect(params.has('seriesId')).toBe(false);
  });

  it('does not repeat a download\'s own name in its Failed-tab reason', async () => {
    const name = '[grp] Some Show 3rd Season (BD 1080p)';
    queueRecords = [{
      id: 4, title: name, source: 'sonarr', instanceId: 'son-1', downloadId: 'D', size: 100, sizeleft: 0,
      status: 'completed', trackedDownloadState: 'importBlocked', trackedDownloadStatus: 'warning', seriesId: null,
      // Sonarr titles a download-level message with the download's name, a file-level one with the file's.
      statusMessages: [
        { title: name, messages: ['Series title mismatch; automatic import is not possible.'] },
        { title: 'Some Show - 01.mkv', messages: ['Not an upgrade'] },
      ],
    }];
    useUIStore.setState({ activityTab: 'failed' });
    await renderPage();
    await waitFor(() => expect(text()).toContain('Series title mismatch'));
    expect(text()).toContain('Some Show - 01.mkv: Not an upgrade');
    expect(text().split(name)).toHaveLength(2);
  });

  it("offers no Import for a Lidarr download, which the import page can't do", async () => {
    queueRecords = [...QUEUE, { ...BLOCKED, source: 'lidarr', instanceId: 'lid-1', title: 'Album.2026' }];
    await renderPage();
    await waitFor(() => expect(text()).toContain('Album.2026'));
    expect(button('Import')).toBeUndefined();
  });

  it('shows an import in progress as importing until the queue drops it', async () => {
    queueRecords = [...QUEUE, BLOCKED];
    let finish: ((value: Response) => void) | null = null;
    const fetchMock = vi.mocked(fetch);
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      // The import command's status poll: held until the test finishes it.
      if (String(url).startsWith('/api/sonarr/command/5')) return new Promise<Response>((done) => { finish = done; });
      return base(url as string, init);
    });
    await renderPage();
    await waitFor(() => expect(text()).toContain('MANUAL IMPORT'));

    void trackManualImport(queryClient, { service: 'sonarr', instanceId: 'son-1', downloadId: 'c', commandId: 5, title: 'Show.S01E02' });
    await waitFor(() => expect(text()).toContain('IMPORTING'));
    expect(button('Import')).toBeUndefined();

    // pollCommand waits 1.5s before asking for the command's status.
    await waitFor(() => expect(finish).not.toBeNull(), 4000);
    await act(async () => finish!(Response.json({ status: 'completed' })));
    // Until the *arr's refresh lands, its queue still lists the download.
    await act(async () => queryClient.invalidateQueries({ queryKey: ['activity', 'queue'] }));
    expect(text()).toContain('IMPORTING');
    expect(button('Import')).toBeUndefined();

    queueRecords = QUEUE;
    await act(async () => queryClient.invalidateQueries({ queryKey: ['activity', 'queue'] }));
    await waitFor(() => expect(text()).not.toContain('Show.S01E02'));
    expect(text()).toContain('2 Tasks');
  }, 10_000);
});
