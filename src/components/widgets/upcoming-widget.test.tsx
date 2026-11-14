// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@/types';

const mocks = vi.hoisted(() => ({ data: [] as CalendarEvent[] }));

vi.mock('@/lib/widgets/use-widget-data', () => ({
  useWidgetData: () => ({ data: mocks.data, loading: false, error: null, offline: false }),
}));
vi.mock('@/lib/widgets/use-element-size', () => ({ useElementSize: () => ({ ref: () => {}, width: 366, height: 300 }) }));
vi.mock('@/lib/widgets/use-list-fetch-size', () => ({ useListFetchSize: () => ({ visibleCount: 10 }) }));
vi.mock('./dashboard-layout-context', () => ({ useDashboardLayout: () => ({ setWidgetLayoutOverride: vi.fn() }) }));
vi.mock('@/components/ui/app-link', () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));

import { UpcomingWidget } from './upcoming-widget';

// A film's release day arrives as that day's UTC midnight (release-day.ts).
const film = (id: string, day: string): CalendarEvent => ({
  id, type: 'movie', title: id, subtitle: '', date: `${day}T00:00:00Z`, hasFile: false, monitored: true, movieId: 1, images: [],
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => vi.useRealTimers());

describe('Upcoming widget relative day', () => {
  it('reads "Today" for a release today and "Tomorrow" for one tomorrow, not hours from their midnight', () => {
    // Noon on Nov 17 here: today's film was "About 12 hours ago".
    vi.setSystemTime(new Date(2026, 10, 17, 12, 0));
    mocks.data = [film('Odyssey', '2026-11-17'), film('Witch', '2026-11-18'), film('Later', '2026-11-27')];
    const { container } = render(<UpcomingWidget refreshInterval={60_000} layoutVariant="list" />);
    const text = container.textContent ?? '';
    expect(text).toContain('Nov 17 · Today');
    expect(text).toContain('Nov 18 · Tomorrow');
    expect(text).toContain('Nov 27 · in 10 days');
    expect(text).not.toMatch(/hours/i);
  });
});
