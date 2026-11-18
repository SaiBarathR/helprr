// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JellyfinItem } from '@/types/jellyfin';

const mocks = vi.hoisted(() => ({ height: 0 }));

vi.mock('@/lib/widgets/use-widget-data', () => ({
  useWidgetData: () => ({
    data: [{
      Id: 'ep-1',
      Name: 'Episode 1',
      SeriesName: 'ReLIFE',
      SeriesId: 'series-1',
      Type: 'Episode',
      ParentIndexNumber: 1,
      IndexNumber: 1,
      UserData: { PlayedPercentage: 40 },
    }] as JellyfinItem[],
    loading: false,
  }),
}));
vi.mock('@/lib/widgets/use-element-size', () => ({ useElementSize: () => ({ ref: () => {}, width: 351, height: mocks.height }) }));
vi.mock('@/lib/widgets/use-list-fetch-size', () => ({ useListFetchSize: () => ({ visibleCount: 10, fetchSize: 10 }) }));
vi.mock('./dashboard-layout-context', () => ({ useDashboardLayout: () => ({ setWidgetLayoutOverride: vi.fn() }) }));
vi.mock('@/components/ui/app-link', () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));

import { ContinueWatchingWidget } from './continue-watching-widget';
import { DEFAULT_DESKTOP_LAYOUT, DEFAULT_MEMBER_MOBILE_LAYOUT, DEFAULT_MOBILE_LAYOUT } from '@/lib/widgets/registry';

const renderCarousel = () => render(
  <ContinueWatchingWidget refreshInterval={60} layoutVariant="carousel" instanceId="cw-1" />,
);

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  mocks.height = 0;
});

// The carousel card is a 165px poster (with the progress bar), a title line
// and an S·E or year line under the header: 243px in all.
describe('Continue Watching in a carousel cell', () => {
  it('keeps the carousel where a whole card fits (a three-row phone cell, 268px)', () => {
    mocks.height = 268;
    renderCarousel();
    expect(screen.getByRole('button', { name: 'Carousel view' })).toBeTruthy();
    expect(document.querySelector('[style*="overflow-x: auto"]')).not.toBeNull();
  });

  it('shows the list in a cell too short for the card (the two-row phone member default, 176px)', () => {
    mocks.height = 176;
    renderCarousel();
    expect(document.querySelector('[style*="overflow-x: auto"]')).toBeNull();
    expect(document.body.textContent).toContain('ReLIFE');
    // Only the list can show there, so the layout toggle steps aside.
    expect(screen.queryByRole('button', { name: 'Carousel view' })).toBeNull();
  });

  it('keeps the chosen layout until the cell is measured', () => {
    renderCarousel();
    expect(document.querySelector('[style*="overflow-x: auto"]')).not.toBeNull();
  });
});

// A phone row is ~84px: two rows hold the list only, so no preset saves a
// carousel the widget would not show. Two columns or fewer are narrow, which
// always shows the list.
describe('Continue Watching presets', () => {
  it('ask for a carousel on a phone only in three rows or more', () => {
    for (const layout of [DEFAULT_DESKTOP_LAYOUT, DEFAULT_MOBILE_LAYOUT, DEFAULT_MEMBER_MOBILE_LAYOUT]) {
      for (const w of layout.filter((item) => item.widgetId === 'continue-watching')) {
        const mobile = w.mobileLayoutOverride ?? w.layoutOverride;
        if (mobile === 'carousel' && (w.mobileColSpan ?? 4) > 2) expect(w.mobileRowSpan ?? 1, w.id).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
