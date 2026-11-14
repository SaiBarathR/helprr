// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { JellyfinItem } from '@/types/jellyfin';

vi.mock('@/lib/hooks/use-watch-skin', () => ({ useWatchSkin: () => 'classic' }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { WatchHero } from '../watch-hero';

const slide = (id: string, name: string, logo: boolean) => ({
  Id: id, Name: name, Type: 'Movie', BackdropImageTags: ['b'], ImageTags: logo ? { Logo: 'l' } : {},
  Overview: `${name} overview`, ProductionYear: 2000 + id.charCodeAt(0),
}) as unknown as JellyfinItem;
const ITEMS = [slide('a', 'Alpha', true), slide('b', 'Black Bag', true), slide('c', 'Gamma', false)];

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
});

const logo = (name: string) => document.querySelector(`img[alt="${name}"]`);
const titleLayer = (name: string) => logo(name)?.closest('[aria-hidden]') ?? null;

it("keeps every slide's logo loaded and crossfades it with the slide instead of swapping one image", async () => {
  render(<WatchHero items={ITEMS} onPlay={() => {}} />);
  const next = logo('Black Bag');
  // Requested up front, not when its slide comes round.
  expect(next?.getAttribute('src')).toContain('type=Logo');
  expect(titleLayer('Alpha')?.getAttribute('aria-hidden')).toBe('false');
  expect(titleLayer('Black Bag')?.getAttribute('aria-hidden')).toBe('true');
  expect(titleLayer('Black Bag')?.className).toContain('opacity-0');
  // Loaded early but behind what is on screen.
  expect(next?.getAttribute('fetchpriority')).toBe('low');
  expect(logo('Alpha')?.getAttribute('fetchpriority')).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: 'Show Black Bag' }));

  // The same element, already loaded, faded in with its backdrop.
  expect(logo('Black Bag')).toBe(next);
  expect(titleLayer('Black Bag')?.className).toContain('opacity-100');
  expect(titleLayer('Black Bag')?.className).toContain('duration-700');
  expect(titleLayer('Alpha')?.getAttribute('aria-hidden')).toBe('true');
  // Its details and overview are in the same layer, so they fade with it
  // rather than switching ahead of the logo and the backdrop.
  const overview = screen.getByText('Black Bag overview');
  expect(overview.closest('[aria-hidden]')).toBe(titleLayer('Black Bag'));
  expect(screen.getByText(/^2098/).closest('[aria-hidden]')).toBe(titleLayer('Black Bag'));
  expect(screen.getByText('Alpha overview').closest('[aria-hidden]')?.className).toContain('opacity-0');
  // A slide with no logo still gets its name as text.
  expect(screen.getByText('Gamma', { selector: 'p' })).toBeTruthy();
});
