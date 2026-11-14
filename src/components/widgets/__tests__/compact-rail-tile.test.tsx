// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

import { CompactRailTile } from '../compact-rail-tile';

const item = { href: '/discover/movie/1', title: 'The Apothecary Diaries Season 3', meta: '2026 · Movie', imageUrl: null };

describe('CompactRailTile', () => {
  it('shows the top title whole with a label that opens the full list', () => {
    render(<CompactRailTile title="Trending Movies" viewAllHref="/discover?section=trending_movies" item={{ ...item, inLibrary: true }} />);
    expect(screen.getByRole('link', { name: 'Trending Movies, view all' }).getAttribute('href')).toBe('/discover?section=trending_movies');
    const row = screen.getByRole('link', { name: /The Apothecary Diaries Season 3/ });
    expect(row.getAttribute('href')).toBe('/discover/movie/1');
    expect(row.textContent).toContain('2026 · Movie');
    expect(screen.getByRole('img', { name: 'In library' })).toBeTruthy();
  });

  it('does not navigate from the row while the dashboard is being edited', () => {
    render(<CompactRailTile title="Trending Anime" viewAllHref="/anime/explore" item={item} editMode />);
    expect(screen.queryByRole('link', { name: /Apothecary/ })).toBeNull();
    expect(screen.getByText('The Apothecary Diaries Season 3')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'In library' })).toBeNull();
  });
});
