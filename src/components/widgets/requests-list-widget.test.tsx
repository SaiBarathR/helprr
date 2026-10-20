// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextActionGroup } from '@/components/ui/quick-context-menu';
import type { EnrichedSeerrRequest } from '@/types/seerr';

const mocks = vi.hoisted(() => ({
  me: null as { role: string; capabilities: Record<string, boolean> } | null,
  results: [] as unknown[],
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
vi.mock('@/components/seerr/pending-approval-section', () => ({ PendingApprovalSection: () => null }));
vi.mock('@/components/seerr/seerr-request-modal', () => ({ SeerrRequestModal: () => null }));
vi.mock('@/components/ui/app-link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/components/media/fade-in-image', () => ({ FadeInImage: () => null }));
// The long-press menu renders its actions inline, keyed by the row's label.
vi.mock('@/components/ui/quick-context-menu', () => ({
  QuickContextMenu: ({ label, groups, children }: { label: string; groups: ContextActionGroup[]; children: ReactNode }) => (
    <div>
      {children}
      <ul aria-label={label}>
        {groups.flatMap((group) => group.actions).map((action) => (
          <li key={action.id}>{action.href ? <a href={action.href}>{action.label}</a> : action.label}</li>
        ))}
      </ul>
    </div>
  ),
}));

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

function openHrefs(title: string) {
  const menu = screen.getByRole('list', { name: `Actions for ${title}` });
  return [...menu.querySelectorAll('a')]
    .filter((link) => link.textContent === 'Open in Helprr')
    .map((link) => link.getAttribute('href'));
}

beforeEach(() => {
  mocks.me = { role: 'admin', capabilities: {} };
  mocks.results = [
    request({ id: 1, type: 'movie' }, 'Whalefall'),
    request({ id: 2, type: 'tv' }, 'Pending Show'),
    request({ id: 3, type: 'movie' }, 'Tenzing', { type: 'movie', id: 42, instanceId: 'radarr-1' }),
    request({ id: 4, type: 'tv' }, 'Library Show', { type: 'series', id: 7, instanceId: 'sonarr-1' }),
    request({ id: 5, type: 'movie', media: undefined }, 'No Media'),
  ];
});
afterEach(cleanup);

describe('RequestsListWidget Open in Helprr', () => {
  it('opens a title that is not in the library on its Discover page', () => {
    render(<RequestsListWidget refreshInterval={0} unbounded />);
    expect(openHrefs('Whalefall')).toEqual(['/discover/movie/1001']);
    expect(openHrefs('Pending Show')).toEqual(['/discover/tv/1002']);
  });

  it('still opens a library title on its library page', () => {
    render(<RequestsListWidget refreshInterval={0} unbounded />);
    expect(openHrefs('Tenzing')).toEqual(['/movies/42?instance=radarr-1']);
    expect(openHrefs('Library Show')).toEqual(['/series/7?instance=sonarr-1']);
  });

  it('offers nothing when the request has no TMDB id', () => {
    render(<RequestsListWidget refreshInterval={0} unbounded />);
    expect(openHrefs('No Media')).toEqual([]);
  });

  it('offers the Discover page to a member who may open title pages, and not to one who may not', () => {
    mocks.me = { role: 'member', capabilities: { 'requests.view': true, 'watchlist.view': true } };
    const { unmount } = render(<RequestsListWidget refreshInterval={0} unbounded />);
    expect(openHrefs('Whalefall')).toEqual(['/discover/movie/1001']);
    unmount();

    mocks.me = { role: 'member', capabilities: { 'requests.view': true } };
    render(<RequestsListWidget refreshInterval={0} unbounded />);
    expect(openHrefs('Whalefall')).toEqual([]);
    expect(openHrefs('Tenzing')).toEqual(['/movies/42?instance=radarr-1']);
  });
});
