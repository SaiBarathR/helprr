// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DiscoverSection } from '@/types';
import { SectionRow } from '../discover-cards';

const handlers = { onOpenItem: vi.fn(), onSeeAll: vi.fn(), onPickGenre: vi.fn(), onPickProvider: vi.fn() };

describe('SectionRow', () => {
  it('renders nothing for a rail whose source failed and came back empty', () => {
    const section: DiscoverSection = { key: 'trending_movies', title: 'Trending Movies', type: 'media', items: [] };
    const { container } = render(<SectionRow section={section} {...handlers} />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('See all')).toBeNull();
  });

  it('keeps its heading when it has items', () => {
    const section: DiscoverSection = { key: 'genres', title: 'Genres', type: 'genre', items: [{ id: 28, name: 'Action', type: 'movie' }] as DiscoverSection['items'] };
    render(<SectionRow section={section} {...handlers} />);
    expect(screen.getByRole('heading', { name: 'Genres' })).toBeTruthy();
    expect(screen.getByText('Action')).toBeTruthy();
  });
});
