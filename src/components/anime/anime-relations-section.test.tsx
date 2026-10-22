// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

import { AnimeRelationsSection } from './anime-relations-section';

it('separates long relation and format badges on the poster and keeps black scrims', () => {
  render(<AnimeRelationsSection relations={[{
    id: 1, title: 'Related manga', coverImage: null, format: 'ONE_SHOT', status: null,
    relationType: 'ALTERNATIVE', averageScore: null, episodes: null, seasonYear: null,
    type: 'MANGA', chapters: 1, volumes: 1,
  }]} />);

  const relation = screen.getByText('Alternative');
  const format = screen.getByText('ONE SHOT');
  expect(relation.className).toContain('top-1 left-1');
  expect(format.className).toContain('bottom-1 right-1');
  expect(format.className).not.toContain('top-1');
  expect(relation.className).toContain('bg-black/55');
  expect(format.className).toContain('bg-black/55');
  expect(format.parentElement).toBe(relation.parentElement);
  expect(format.parentElement?.textContent).not.toContain('vols');
});
