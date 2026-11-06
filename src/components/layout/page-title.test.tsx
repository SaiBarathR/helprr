// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PageTitle } from './page-title';

it('shows the page name as a visible large title, the size the Settings pages use', () => {
  render(<PageTitle>Torrents</PageTitle>);
  const title = screen.getByRole('heading', { level: 1, name: 'Torrents' });
  expect(title.className).not.toContain('sr-only');
  expect(title.className).toContain('text-2xl');
  expect(title.className).toContain('font-semibold');
});

it('lets a page inset the title to its own content edge', () => {
  render(<PageTitle className="px-4">Settings</PageTitle>);
  const title = screen.getByRole('heading', { level: 1, name: 'Settings' });
  expect(title.className).toContain('px-4');
  expect(title.className).not.toContain('px-1');
});
