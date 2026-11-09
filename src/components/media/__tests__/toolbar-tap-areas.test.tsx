// @vitest-environment jsdom

import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@/components/ui/app-link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));

import { ViewSelector } from '../view-selector';
import { MoviesSubNav } from '../movies-subnav';

// The visible controls stay their size (a 44px pill, a 34px switch); the tap
// area reaches 44×44 through width plus touch-target-y (globals.css).
it('gives each view mode a 44px-wide button with a 44px-tall tap area', () => {
  render(<ViewSelector value="posters" onChange={() => {}} />);
  for (const name of ['Posters', 'Overview']) {
    const button = screen.getByRole('button', { name });
    expect(button.className).toContain('min-w-11');
    expect(button.className).toContain('touch-target-y');
    expect(button.className).toContain('relative');
  }
});

it('gives the Library and Collections links 44px tap areas while the switch keeps its height', () => {
  render(<MoviesSubNav active="library" />);
  for (const name of ['Library', 'Collections']) {
    const link = screen.getByRole('link', { name });
    expect(link.className).toContain('min-w-11');
    expect(link.className).toContain('touch-target-y');
    expect(link.className).toContain('py-1.5');
  }
});
