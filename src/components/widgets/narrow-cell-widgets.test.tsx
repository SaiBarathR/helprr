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
vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { ProwlarrStatsSummaryWidget } from './prowlarr-stats-summary-widget';
import { TorrentWidget } from './torrent-widget';

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
