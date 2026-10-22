// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedSeerrRequest } from '@/types/seerr';

const mocks = vi.hoisted(() => ({
  me: null as { role: string; tmdbConfigured: boolean; capabilities: Record<string, boolean> } | null,
  results: [] as unknown[],
  pendingApproval: false,
}));

vi.mock('@/components/permission-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/permission-provider')>()),
  useMe: () => mocks.me,
  useCan: () => mocks.me?.role === 'admin',
}));
vi.mock('@/lib/widgets/use-widget-data', () => ({
  useWidgetData: () => ({
    data: { pageInfo: { page: 1, pages: 1, pageSize: 50, results: mocks.results.length }, results: mocks.results },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock('@/lib/widgets/use-element-size', () => ({ useElementSize: () => ({ ref: { current: null }, height: 800 }) }));
vi.mock('@/lib/widgets/use-list-fetch-size', () => ({ useListFetchSize: () => ({ visibleCount: 10 }) }));
vi.mock('@/lib/hooks/use-external-urls', () => ({ useExternalUrls: () => ({}) }));
vi.mock('@/components/layout/badge-provider', () => ({ useBadgeActions: () => ({ adjustBadge: vi.fn() }) }));
vi.mock('@/components/seerr/pending-approval-section', () => ({
  PendingApprovalSection: () => mocks.pendingApproval ? <section>Pending approval: Family movie</section> : null,
}));
vi.mock('@/components/seerr/seerr-request-modal', () => ({ SeerrRequestModal: () => null }));
vi.mock('@/components/ui/app-link', () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));
vi.mock('@/components/media/fade-in-image', () => ({ FadeInImage: () => null }));

import { RequestsListWidget } from './requests-list-widget';

function request(overrides: Partial<EnrichedSeerrRequest> & Pick<EnrichedSeerrRequest, 'id' | 'type'>, title: string, helprr: EnrichedSeerrRequest['enriched']['helprr'] = null) {
  return {
    status: 1,
    createdAt: '2026-10-20T00:00:00.000Z',
    requestedBy: { id: 1, displayName: 'Family' },
    media: { tmdbId: 1000 + overrides.id, status: 2 },
    ...overrides,
    enriched: { title, year: 2026, posterUrl: null, helprr },
  } as EnrichedSeerrRequest;
}

// Opens the row's ⋯ menu (always on screen, unlike the long-press menu, which
// needs two actions) and reads where its Open in Helprr goes.
async function openHrefs(title: string) {
  const user = userEvent.setup();
  const row = screen.getByText(title).closest('div.border') as HTMLElement;
  await user.click(within(row).getByRole('button', { name: 'Request actions' }));
  const menu = await screen.findByRole('menu');
  const hrefs = within(menu).queryAllByRole('menuitem', { name: 'Open in Helprr' }).map((item) => item.getAttribute('href'));
  await user.keyboard('{Escape}');
  return hrefs;
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  mocks.me = { role: 'admin', tmdbConfigured: true, capabilities: {} };
  mocks.pendingApproval = false;
  mocks.results = [
    request({ id: 1, type: 'movie' }, 'Whalefall'),
    request({ id: 2, type: 'tv' }, 'Pending Show'),
    request({ id: 3, type: 'movie' }, 'Tenzing', { type: 'movie', id: 42, instanceId: 'radarr-1' }),
    request({ id: 4, type: 'tv' }, 'Library Show', { type: 'series', id: 7, instanceId: 'sonarr-1' }),
    request({ id: 5, type: 'movie', media: undefined }, 'No Media'),
  ];
});
afterEach(cleanup);

describe('RequestsListWidget empty Seerr results', () => {
  it.each([false, true])('qualifies pending results beside Helprr approvals (unbounded=%s)', (unbounded) => {
    mocks.results = [];
    mocks.pendingApproval = true;
    render(<RequestsListWidget refreshInterval={0} filter="pending" unbounded={unbounded} />);
    expect(screen.getByText('Pending approval: Family movie')).toBeTruthy();
    expect(screen.getByText('No pending requests in Seerr')).toBeTruthy();
    expect(screen.queryByText('No pending requests', { exact: true })).toBeNull();
  });

  it('qualifies the unfiltered empty state too', () => {
    mocks.results = [];
    render(<RequestsListWidget refreshInterval={0} filter="all" unbounded />);
    expect(screen.getByText('No requests in Seerr')).toBeTruthy();
  });
});

describe('RequestsListWidget Open in Helprr', () => {
  it('opens a title that is not in the library on its Discover page', async () => {
    render(<RequestsListWidget refreshInterval={0} unbounded />);
    expect(await openHrefs('Whalefall')).toEqual(['/discover/movie/1001']);
    expect(await openHrefs('Pending Show')).toEqual(['/discover/tv/1002']);
  });

  it('still opens a library title on its library page', async () => {
    render(<RequestsListWidget refreshInterval={0} unbounded />);
    expect(await openHrefs('Tenzing')).toEqual(['/movies/42?instance=radarr-1']);
    expect(await openHrefs('Library Show')).toEqual(['/series/7?instance=sonarr-1']);
  });

  it('offers nothing when the request has no TMDB id', async () => {
    render(<RequestsListWidget refreshInterval={0} unbounded />);
    expect(await openHrefs('No Media')).toEqual([]);
  });

  it('offers no Discover page without a TMDB connection, but still the library page', async () => {
    mocks.me = { role: 'admin', tmdbConfigured: false, capabilities: {} };
    render(<RequestsListWidget refreshInterval={0} unbounded />);
    expect(await openHrefs('Whalefall')).toEqual([]);
    expect(await openHrefs('Tenzing')).toEqual(['/movies/42?instance=radarr-1']);
  });

  it('sends a member to the pages they may open: library, else Discover, else nothing', async () => {
    mocks.me = { role: 'member', tmdbConfigured: true, capabilities: { 'requests.view': true, 'movies.view': true, 'watchlist.view': true } };
    const first = render(<RequestsListWidget refreshInterval={0} unbounded />);
    expect(await openHrefs('Whalefall')).toEqual(['/discover/movie/1001']);
    expect(await openHrefs('Tenzing')).toEqual(['/movies/42?instance=radarr-1']);
    // No series.view: the library series opens on Discover instead.
    expect(await openHrefs('Library Show')).toEqual(['/discover/tv/1004']);
    first.unmount();

    mocks.me = { role: 'member', tmdbConfigured: true, capabilities: { 'requests.view': true } };
    render(<RequestsListWidget refreshInterval={0} unbounded />);
    expect(await openHrefs('Whalefall')).toEqual([]);
    expect(await openHrefs('Tenzing')).toEqual([]);
  });
});
