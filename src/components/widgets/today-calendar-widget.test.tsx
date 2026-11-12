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
    }] satisfies CalendarEvent[],
    loading: false,
  }),
}));
vi.mock('@/lib/widgets/use-element-size', () => ({ useElementSize: () => ({ ref: () => {}, width: 366, height: mocks.height }) }));
vi.mock('@/lib/widgets/use-list-fetch-size', () => ({ useListFetchSize: () => ({ visibleCount: 10 }) }));
vi.mock('./dashboard-layout-context', () => ({ useDashboardLayout: () => ({ setWidgetLayoutOverride: vi.fn() }) }));
vi.mock('@/components/ui/app-link', () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));

import { TodayCalendarWidget } from './today-calendar-widget';

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
