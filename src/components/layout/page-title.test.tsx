// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PageTitle } from './page-title';

// Owner rule: top-level pages have no visible title; the heading is for screen readers only.
it('renders the page name as a screen-reader-only heading, never a visible title', () => {
  render(<PageTitle>Torrents</PageTitle>);
  const title = screen.getByRole('heading', { level: 1, name: 'Torrents' });
  expect(title.className).toBe('sr-only');
});
