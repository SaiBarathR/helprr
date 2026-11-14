// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RandomPick } from '@/types';

const mocks = vi.hoisted(() => ({ data: null as unknown, loading: false }));
vi.mock('@/lib/widgets/use-widget-data', () => ({ useWidgetData: () => ({ data: mocks.data, loading: mocks.loading, refresh: vi.fn() }) }));
vi.mock('./use-widget-filter', () => ({ useWidgetFilter: (_id: string, defaults: object) => [defaults, vi.fn()] }));
vi.mock('@/components/permission-provider', () => ({ useMe: () => null, hasCapability: () => false }));
vi.mock('@/components/media/hero-image', () => ({ HeroImage: () => <span data-backdrop /> }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

import { RandomWatchWidget } from './random-watch-widget';

const pick: RandomPick = {
  mediaType: 'movie', id: 7, instanceId: 'r1', title: 'The Sheep Detectives', year: 2026, overview: null,
  posterUrl: null, backdropUrl: 'https://example.test/b.jpg', runtime: 109, genres: ['Comedy'], href: '/movies/7?instance=r1', rating: 7.9,
};

beforeEach(() => {
  mocks.data = { pick, poolSize: 2 };
  mocks.loading = false;
});

describe('Random Pick sizes', () => {
  it('takes the compact rail tile in a 2×1 phone cell, where the header left the pick no room', () => {
    render(<RandomWatchWidget refreshInterval={60_000} narrow rowSpan={1} />);
    expect(screen.getByRole('link', { name: 'Random Pick, view all' }).getAttribute('href')).toBe('/recommendations?mode=random');
    const row = screen.getByRole('link', { name: /The Sheep Detectives/ });
    expect(row.getAttribute('href')).toBe('/movies/7?instance=r1');
    expect(row.textContent).toContain('2026 · Movie');
  });

  it('keeps its header and filters in a wide one-row cell, as For You and Upcoming do', () => {
    render(<RandomWatchWidget refreshInterval={60_000} rowSpan={1} />);
    expect(screen.queryByRole('link', { name: 'Random Pick, view all' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Random pick filters' })).toBeTruthy();
  });

  it('does not claim "nothing matches" in a 2×1 cell in edit mode, which loads nothing', () => {
    mocks.data = null;
    render(<RandomWatchWidget refreshInterval={60_000} narrow rowSpan={1} editMode />);
    expect(screen.queryByText('Nothing matches')).toBeNull();
    expect(screen.getByText('Random title')).toBeTruthy();
  });

  it('keeps the backdrop in a narrow taller cell, which was an empty black block above the title', () => {
    const { container } = render(<RandomWatchWidget refreshInterval={60_000} narrow rowSpan={2} />);
    expect(container.querySelector('[data-backdrop]')).not.toBeNull();
    expect(screen.getAllByText('The Sheep Detectives').length).toBeGreaterThan(0);
  });

  it('has a short name and hides the pool size and filter chips by cell width, never cutting them', () => {
    const { container } = render(<RandomWatchWidget refreshInterval={60_000} rowSpan={2} />);
    expect(screen.getByText('Random').className).toContain('@max-[129px]/cell:inline');
    expect(screen.getByText('Random Pick').className).toContain('@max-[129px]/cell:hidden');
    expect(screen.getByText('Pool 2').closest('.\\@max-\\[239px\\]\\/cell\\:hidden')).not.toBeNull();
    // The class carries display, so the container query can hide the row (an inline display overrode it).
    const chips = screen.getByRole('group', { name: 'Random pick filters' });
    expect(chips.className).toContain('@max-[229px]/cell:hidden');
    expect(chips.style.display).toBe('');
    const genres = screen.getByText('Comedy').closest('.flex');
    expect(genres?.className).toContain('@max-[239px]/cell:hidden');
    expect((genres as HTMLElement).style.display).toBe('');
    expect(container.textContent).not.toContain('Nothing matches');
  });
});
