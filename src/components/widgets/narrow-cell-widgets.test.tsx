// @vitest-environment jsdom
// Tiles that adapt to their measured width (a colSpan 2–4 cell beside an
// expanded sidebar at 820px, or a 1×1/2×1 cell on a 320 phone).
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  size: { width: 400, height: 200 },
  data: null as unknown,
}));
vi.mock('@/lib/widgets/use-element-size', () => ({ useElementSize: () => ({ ref: { current: null }, ...mocks.size }) }));
vi.mock('@/lib/widgets/use-widget-data', () => ({ useWidgetData: () => ({ data: mocks.data, loading: false }) }));
vi.mock('./use-widget-filter', () => ({ useWidgetFilter: (_id: string, defaults: object) => [defaults, vi.fn(), vi.fn()] }));
vi.mock('./dashboard-layout-context', () => ({ useDashboardLayout: () => ({ setWidgetLayoutOverride: vi.fn() }) }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { ProwlarrStatsSummaryWidget } from './prowlarr-stats-summary-widget';
import { TorrentWidget } from './torrent-widget';
import { RecentlyAddedWidget } from './recently-added-widget';
import { ForYouWidget } from './for-you-widget';
import { ServiceHealthWidget } from './service-health-widget';

beforeEach(() => {
  mocks.size = { width: 400, height: 200 };
});

describe('Prowlarr Stats', () => {
  beforeEach(() => {
    mocks.data = { indexers: [{ numberOfQueries: 118_000, numberOfRssQueries: 500, numberOfAuthQueries: 0, numberOfGrabs: 83, numberOfFailedQueries: 56, numberOfFailedRssQueries: 0 }] };
  });

  it('names the range in full where there is room', () => {
    mocks.size = { width: 230, height: 172 };
    render(<ProwlarrStatsSummaryWidget refreshInterval={60_000} />);
    expect(screen.getByRole('button', { name: /^Range:/ }).textContent).toContain('30 DAYS');
  });

  it('shortens the range to "30D" in a cell under 200px, where "30 DAYS" was cut', () => {
    mocks.size = { width: 64, height: 172 };
    render(<ProwlarrStatsSummaryWidget refreshInterval={60_000} />);
    expect(screen.getByRole('button', { name: /^Range:/ }).textContent).toContain('30D');
  });
});

describe('Torrents', () => {
  beforeEach(() => {
    mocks.data = { total: 1, downloading: 1, seeding: 0, paused: 0, dlSpeed: 359_300, upSpeed: 0, dlTotal: 5.2e9, upTotal: 0, dlRateLimit: 0, upRateLimit: 0 };
  });

  it('keeps each speed and its total on a phone cell with room', () => {
    mocks.size = { width: 148, height: 60 };
    render(<TorrentWidget refreshInterval={60_000} narrow />);
    expect(screen.getByText('4.8 GB')).toBeTruthy();
  });

  it('drops the totals in a 120px cell so the speed is not cut', () => {
    mocks.size = { width: 120, height: 60 };
    render(<TorrentWidget refreshInterval={60_000} narrow />);
    expect(screen.getByText('350.9 KB/s')).toBeTruthy();
    expect(screen.queryByText('4.8 GB')).toBeNull();
  });
});

describe('Poster rails in a 2×1 phone cell', () => {
  it('Recently Added shows its newest import whole, with a label to Activity', () => {
    mocks.data = [{ id: 'e1', title: 'Black Clover', subtitle: 'S03E07 - The Bet', type: 'episode', date: new Date().toISOString(), poster: null, href: '/series/7' }];
    render(<RecentlyAddedWidget refreshInterval={60_000} narrow rowSpan={1} />);
    expect(screen.getByRole('link', { name: /^Recently Added/ }).getAttribute('href')).toBe('/activity');
    const row = screen.getByRole('link', { name: /Black Clover/ });
    expect(row.getAttribute('href')).toBe('/series/7');
    expect(row.textContent).toContain('S03E07 - The Bet');
  });

  it('Recently Added keeps its full rail in a taller cell', () => {
    mocks.data = [{ id: 'e1', title: 'Black Clover', subtitle: 'S03E07', type: 'episode', date: new Date().toISOString(), poster: null, href: '/series/7' }];
    render(<RecentlyAddedWidget refreshInterval={60_000} narrow rowSpan={2} />);
    expect(screen.queryByRole('link', { name: /^Recently Added/ })).toBeNull();
    expect(screen.getByText('Recently Added')).toBeTruthy();
  });

  it('For You shows its top suggestion whole', () => {
    mocks.data = [{ tmdbId: 1, mediaType: 'movie', title: 'Drawing Closer', year: 2024, posterPath: null, href: '/discover/movie/1', reason: 'Because you added X' }];
    render(<ForYouWidget refreshInterval={60_000} narrow rowSpan={1} />);
    const row = screen.getByRole('link', { name: /Drawing Closer/ });
    expect(row.getAttribute('href')).toBe('/discover/movie/1');
    expect(row.textContent).toContain('2024 · Movie');
  });

  it('says why when there is nothing to show', () => {
    mocks.data = [];
    render(<ForYouWidget refreshInterval={60_000} narrow rowSpan={1} />);
    expect(screen.getByText('No suggestions yet')).toBeTruthy();
  });

  it('does not claim "no suggestions" in edit mode, which loads none', () => {
    mocks.data = [];
    render(<ForYouWidget refreshInterval={60_000} narrow rowSpan={1} editMode />);
    expect(screen.queryByText('No suggestions yet')).toBeNull();
    expect(screen.getByText('Top suggestion')).toBeTruthy();
  });

  it('Recently Added does not claim "no recent imports" in edit mode either', () => {
    mocks.data = [];
    render(<RecentlyAddedWidget refreshInterval={60_000} narrow rowSpan={1} editMode />);
    expect(screen.queryByText('No recent imports')).toBeNull();
    expect(screen.getByText('Newest import')).toBeTruthy();
  });
});

describe('Service Health', () => {
  const svc = (label: string, ok: boolean) => ({ instanceId: label, type: 'SONARR', label, ok });

  it('shows the count in a one-column phone cell, where the label and rows were cut', () => {
    mocks.size = { width: 44, height: 60 };
    mocks.data = [svc('a', true), svc('b', true), svc('c', false)];
    const { container } = render(<ServiceHealthWidget refreshInterval={60_000} narrow colSpan={1} />);
    expect(screen.getByText('Health')).toBeTruthy();
    expect(screen.getByText('2/3')).toBeTruthy();
    expect(container.textContent).toContain('1 down');
    expect(screen.queryByText('a')).toBeNull();
  });

  it('says None in a one-column cell when there are no services, not "0/0"', () => {
    mocks.size = { width: 44, height: 60 };
    mocks.data = [];
    const { container } = render(<ServiceHealthWidget refreshInterval={60_000} narrow colSpan={1} />);
    expect(container.textContent).not.toContain('0/0');
    expect(screen.getByText('None')).toBeTruthy();
  });

  it('keeps the list of services in a wider cell', () => {
    mocks.data = [svc('a', true), svc('b', true)];
    render(<ServiceHealthWidget refreshInterval={60_000} narrow colSpan={2} />);
    expect(screen.getByText(/Health · 2\/2/)).toBeTruthy();
  });
});
