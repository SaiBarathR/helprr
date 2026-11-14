// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@/types';

const mocks = vi.hoisted(() => ({ height: 0 }));

vi.mock('@/lib/widgets/use-widget-data', () => ({
  useWidgetData: () => ({
    data: [{
      id: 'ep-1',
      type: 'episode',
      title: 'Classroom of the Elite',
      subtitle: 'S01E03 - Episode 3',
      date: '2026-11-13T19:30:00.000Z',
      hasFile: false,
      monitored: true,
      seriesId: 1,
      images: [],
    }, {
      id: 'radarr-1-7-digital',
      type: 'movie',
      title: 'The Odyssey',
      subtitle: '2026 - Universal Pictures',
      date: '2026-11-13T00:00:00Z',
      hasFile: false,
      monitored: true,
      movieId: 7,
      releaseType: 'digital',
      images: [],
    }] satisfies CalendarEvent[],
    loading: false,
  }),
}));
vi.mock('@/lib/widgets/use-element-size', () => ({ useElementSize: () => ({ ref: () => {}, width: 366, height: mocks.height }) }));
vi.mock('@/lib/widgets/use-list-fetch-size', () => ({ useListFetchSize: () => ({ visibleCount: 10 }) }));
vi.mock('./dashboard-layout-context', () => ({ useDashboardLayout: () => ({ setWidgetLayoutOverride: vi.fn() }) }));
vi.mock('@/components/ui/app-link', () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));

import { TodayCalendarWidget } from './today-calendar-widget';
import { DEFAULT_DESKTOP_LAYOUT, DEFAULT_MEMBER_MOBILE_LAYOUT, DEFAULT_MOBILE_LAYOUT } from '@/lib/widgets/registry';

const renderCarousel = () => render(
  <TodayCalendarWidget refreshInterval={60} layoutVariant="carousel" instanceId="today-1" />,
);

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  mocks.height = 0;
});

// The carousel card is a 165px poster (badges and air time on it) and a title
// line under the header; the list row scrolls inside the cell.
describe('Today widget in a carousel cell', () => {
  it('keeps the carousel where a whole card fits (a three-row phone cell, 252px)', () => {
    mocks.height = 252;
    renderCarousel();
    expect(screen.getByRole('button', { name: 'Carousel view' })).toBeTruthy();
    expect(document.querySelector('[style*="overflow-x: auto"]')).not.toBeNull();
  });

  it('shows the list in a cell too short for the card (the two-row phone default, 160px)', () => {
    mocks.height = 160;
    renderCarousel();
    const scroller = document.querySelector('[style*="overflow-y: auto"]');
    expect(scroller).not.toBeNull();
    expect(scroller!.textContent).toContain('Classroom of the Elite');
    expect(document.querySelector('[style*="overflow-x: auto"]')).toBeNull();
    // Only the list can show there, so the layout toggle steps aside.
    expect(screen.queryByRole('button', { name: 'Carousel view' })).toBeNull();
  });

  it('keeps the chosen layout until the cell is measured', () => {
    renderCarousel();
    expect(document.querySelector('[style*="overflow-x: auto"]')).not.toBeNull();
  });
});

// A phone row is ~84px: two rows (160px inside the cell) hold the list only,
// so no preset saves a carousel the widget would not show. Two columns or
// fewer are narrow, which always shows the list (widget-grid-mobile.tsx).
describe('Today widget presets', () => {
  it('ask for a carousel on a phone only in three rows or more', () => {
    for (const layout of [DEFAULT_DESKTOP_LAYOUT, DEFAULT_MOBILE_LAYOUT, DEFAULT_MEMBER_MOBILE_LAYOUT]) {
      for (const w of layout.filter((item) => item.widgetId === 'today-calendar')) {
        const mobile = w.mobileLayoutOverride ?? w.layoutOverride;
        if (mobile === 'carousel' && (w.mobileColSpan ?? 4) > 2) expect(w.mobileRowSpan ?? 1, w.id).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('Today widget times', () => {
  it("gives an episode its air time and a film's release day no time (All day)", () => {
    mocks.height = 160;
    renderCarousel();
    const rows = [...document.querySelectorAll('a')].map((a) => a.textContent ?? '');
    const film = rows.find((text) => text.includes('The Odyssey'))!;
    expect(film).toContain('All day');
    // Upstream's UTC midnight is not a time: 5:30 AM in India, the evening before in Los Angeles.
    expect(film).not.toMatch(/\d:\d\d/);
    expect(rows.find((text) => text.includes('Classroom of the Elite'))).toMatch(/\d:\d\d/);
  });
});
