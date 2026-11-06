// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MePayload } from '@/components/permission-provider';
import { ADMIN_TEMPLATE, MEMBER_TEMPLATE } from '@/lib/permissions';

const mocks = vi.hoisted(() => ({ me: null as MePayload | null }));

vi.mock('@/components/permission-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/permission-provider')>()),
  useMe: () => mocks.me,
}));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import SettingsIndexPage from './page';

const ADMIN = { role: 'admin', template: 'admin', capabilities: ADMIN_TEMPLATE } as MePayload;
const MEMBER = { role: 'member', template: 'member', capabilities: MEMBER_TEMPLATE } as MePayload;

function renderPage(me: MePayload) {
  mocks.me = me;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SettingsIndexPage /></QueryClientProvider>);
}

function linkHrefs(container: HTMLElement = document.body) {
  return within(container).queryAllByRole('link').map((link) => link.getAttribute('href'));
}

/** Hrefs of the rows under a group heading. */
function groupHrefs(heading: string) {
  return linkHrefs(screen.getByText(heading).parentElement as HTMLElement);
}

function headings() {
  return Array.from(document.querySelectorAll('.grouped-section-title')).map((el) => el.textContent);
}

describe('Settings index', () => {
  beforeEach(() => {
    // Admin rows fetch connection counts and the update check; keep them pending.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('groups an admin\'s rows under headings', () => {
    renderPage(ADMIN);

    expect(headings()).toEqual(['Server', 'Integrations', 'You', 'Data & logs']);
    expect(groupHrefs('Server')).toEqual(['/settings/instances', '/settings/users', '/settings/status', '/settings/downloads']);
    expect(groupHrefs('Integrations')).toEqual(['/settings/youtube', '/settings/anime-mappings']);
    expect(groupHrefs('You')).toEqual([
      '/settings/preferences', '/settings/notifications', '/settings/appearance', '/settings/sessions', '/settings/account',
    ]);
    expect(groupHrefs('Data & logs')).toEqual([
      '/settings/storage', '/settings/backup', '/settings/file-audit', '/settings/logging', '/logs',
    ]);
    // About closes the list in its own untitled group.
    expect(linkHrefs().at(-1)).toBe('/settings/about');
  });

  it('shows a member only their rows and no admin-only groups', () => {
    renderPage(MEMBER);

    expect(screen.getByRole('link', { name: /About/ }).getAttribute('href')).toBe('/settings/about');
    expect(linkHrefs()).toEqual([
      '/settings/status',
      '/settings/preferences', '/settings/notifications', '/settings/appearance', '/settings/sessions', '/settings/account',
      '/settings/tips', '/settings/about',
    ]);
    expect(headings()).toEqual(['Server', 'You']);
  });

  it('filters by title and hides groups left empty', async () => {
    const user = userEvent.setup();
    renderPage(ADMIN);

    await user.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'users');

    expect(linkHrefs()).toEqual(['/settings/users']);
    expect(screen.getByText('Server')).toBeTruthy();
    expect(screen.queryByText('You')).toBeNull();
  });

  it('filters by keyword, ignoring case', async () => {
    const user = userEvent.setup();
    renderPage(ADMIN);
    const search = screen.getByRole('searchbox', { name: 'Search settings' });

    await user.type(search, 'bottom bar');
    expect(linkHrefs()).toEqual(['/settings/appearance']);

    await user.clear(search);
    await user.type(search, 'TMDB');
    expect(linkHrefs()).toEqual(['/settings/instances']);

    await user.clear(search);
    await user.type(search, 'subtitles');
    expect(linkHrefs()).toEqual(['/settings/preferences']);
  });

  it('finds Tips & gestures by gesture, search and Siri keywords', async () => {
    const user = userEvent.setup();
    renderPage(MEMBER);
    const search = screen.getByRole('searchbox', { name: 'Search settings' });

    for (const term of ['long-press', 'swipe', '⌘K', 'siri']) {
      await user.clear(search);
      await user.type(search, term);
      expect(linkHrefs()).toEqual(['/settings/tips']);
    }
  });

  it('does not let a member find admin rows by keyword', async () => {
    const user = userEvent.setup();
    renderPage(MEMBER);

    await user.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'tmdb');

    expect(linkHrefs()).toEqual([]);
  });

  it('says when nothing matches', async () => {
    const user = userEvent.setup();
    renderPage(MEMBER);

    await user.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'zzz');

    expect(linkHrefs()).toEqual([]);
    expect(screen.getByText(/No settings match/).textContent).toBe('No settings match “zzz”');
    expect(headings()).toEqual([]);
  });

  it('matches password on Account only for a person with a local password', async () => {
    const user = userEvent.setup();
    renderPage({ ...MEMBER, hasLocalPassword: true } as MePayload);
    await user.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'password');
    expect(linkHrefs()).toEqual(['/settings/account']);
  });

  it('does not offer a password to a person without one', async () => {
    const user = userEvent.setup();
    renderPage(MEMBER);
    await user.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'password');
    expect(linkHrefs()).toEqual([]);
  });
});
