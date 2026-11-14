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

import { UpcomingWidget, mergeFilmReleaseDays } from './upcoming-widget';

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
    // The date and the distance are separate whole parts (a narrow row hides the distance whole).
    expect(text).toContain('Nov 17· Today');
    expect(text).toContain('Nov 18· Tomorrow');
    expect(text).toContain('Nov 27· in 10 days');
    expect(text).not.toMatch(/hours/i);
  });
});

describe('Upcoming widget, one row per film-day', () => {
  const release = (releaseType: 'cinema' | 'physical' | 'digital', day: string, movieId = 511): CalendarEvent => ({
    ...film('The Odyssey', day), id: `radarr-c1-${movieId}-${releaseType}`, movieId, releaseType, instanceId: 'c1',
  });

  it("merges a film's releases on the same day and keeps each type", () => {
    const merged = mergeFilmReleaseDays([release('physical', '2026-11-17'), release('digital', '2026-11-17')]);
    expect(merged).toHaveLength(1);
    expect(merged[0].releaseTypes).toEqual(['physical', 'digital']);
  });

  it('keeps different days, films and instances apart', () => {
    const other = { ...release('digital', '2026-11-17'), instanceId: 'c2' };
    const merged = mergeFilmReleaseDays([
      release('cinema', '2026-11-17'), release('digital', '2026-11-20'), release('digital', '2026-11-17', 9), other,
    ]);
    expect(merged.map((e) => e.releaseTypes)).toEqual([['cinema'], ['digital'], ['digital'], ['digital']]);
  });

  it('lists the film once and names both release types', () => {
    vi.setSystemTime(new Date(2026, 10, 17, 12, 0));
    mocks.data = mergeFilmReleaseDays([release('physical', '2026-11-17'), release('digital', '2026-11-17')]);
    const { container, getAllByRole } = render(<UpcomingWidget refreshInterval={60_000} layoutVariant="list" />);
    expect(getAllByRole('link').filter((a) => a.getAttribute('href') === '/movies/511?instance=c1')).toHaveLength(1);
    expect(container.textContent).toContain('Physical');
    expect(container.textContent).toContain('Digital');
  });

  it('shows the next release whole in a 2×1 phone cell', () => {
    vi.setSystemTime(new Date(2026, 10, 17, 12, 0));
    mocks.data = mergeFilmReleaseDays([release('physical', '2026-11-17'), release('digital', '2026-11-17')]);
    const { getByRole } = render(<UpcomingWidget refreshInterval={60_000} narrow rowSpan={1} />);
    expect(getByRole('link', { name: 'Upcoming, view all' }).getAttribute('href')).toBe('/calendar');
    const row = getByRole('link', { name: /The Odyssey/ });
    expect(row.getAttribute('href')).toBe('/movies/511?instance=c1');
    // Coloured tags after the date, each its own part, so a narrow tile hides one whole rather than cutting it.
    expect([...row.querySelectorAll('span')].map((s) => s.textContent)).toEqual(['Nov 17', 'PHY', 'DIG']);
  });

  it('keeps a timed episode\'s day and time as separate whole parts in a list row', () => {
    vi.setSystemTime(new Date(2026, 10, 17, 12, 0));
    mocks.data = [{ ...film('Aoashi', '2026-11-18'), type: 'episode', seriesId: 4, subtitle: 'S02E07 - Notebook', date: new Date(2026, 10, 18, 20, 30).toISOString() }];
    const { getByRole } = render(<UpcomingWidget refreshInterval={60_000} layoutVariant="list" />);
    const parts = [...getByRole('link', { name: /Aoashi/ }).querySelectorAll('span')].map((s) => s.textContent);
    expect(parts).toEqual(['Nov 18', '8:30 PM', '· in 1 day']);
  });

  it('shows "downloaded" as a badge where the narrow row hides the poster that carries its check', () => {
    vi.setSystemTime(new Date(2026, 10, 17, 12, 0));
    mocks.data = [{ ...film('Aoashi', '2026-11-18'), type: 'episode', seriesId: 4, hasFile: true }, film('Later', '2026-11-20')];
    const { getAllByRole } = render(<UpcomingWidget refreshInterval={60_000} layoutVariant="list" />);
    const badges = getAllByRole('img', { name: 'Downloaded' });
    expect(badges).toHaveLength(1);
    expect(badges[0].className).toContain('hidden @max-[159px]/cell:inline-flex');
    // The poster wrapper hides below the same width.
    expect(badges[0].closest('a')?.querySelector('.\\@max-\\[159px\\]\\/cell\\:hidden')).not.toBeNull();
  });

  it('does not claim "nothing upcoming" in a 2×1 cell in edit mode, which loads nothing', () => {
    mocks.data = [];
    const { container } = render(<UpcomingWidget refreshInterval={60_000} narrow rowSpan={1} editMode />);
    expect(container.textContent).not.toContain('Nothing upcoming');
    expect(container.textContent).toContain('Next release');
  });
});
