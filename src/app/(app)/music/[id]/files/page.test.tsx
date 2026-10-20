// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockContextAction = { id: string; label: string; href?: string; onSelect?: () => void };

const mocks = vi.hoisted(() => ({
  search: 'instance=lid-2',
  canManageActivity: true,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '9' }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => cap !== 'activity.manage' || mocks.canManageActivity }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
// Each file row's quick actions as plain buttons beside it.
vi.mock('@/components/ui/quick-context-menu', () => ({
  QuickContextMenu: ({ children, label, actions }: { children: React.ReactNode; label: string; actions: MockContextAction[] }) => (
    <>
      {children}
      <div role="group" aria-label={label}>
        {actions.map((action) => (action.href
          ? <a key={action.id} href={action.href}>{action.label}</a>
          : <button key={action.id} type="button" onClick={action.onSelect}>{action.label}</button>))}
      </div>
    </>
  ),
}));

import ArtistFilesPage from './page';

const routes: Record<string, unknown> = {
  '/api/lidarr/9': { id: 9, artistName: 'Band' },
  '/api/lidarr/9/albums': [{ id: 31, title: 'First Album' }, { id: 32, title: 'Second Album' }],
  '/api/lidarr/trackfile': [
    { id: 1, albumId: 31, path: '/music/Band/First Album/01 - One.flac', size: 1000 },
    { id: 2, albumId: 32, path: '/music/Band/Second Album/01 - Two.flac', size: 1000 },
  ],
  '/api/lidarr/history/artist': [],
};

beforeEach(() => {
  mocks.canManageActivity = true;
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost');
    return new Response(JSON.stringify(routes[url.pathname] ?? []), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ArtistFilesPage /></QueryClientProvider>);
}

describe('artist files page', () => {
  it("searches a file row's own album, on the page's instance", async () => {
    renderPage();
    const searchLink = (file: string) =>
      within(screen.getByRole('group', { name: `Actions for ${file}` })).getByRole('link', { name: 'Interactive search…' }).getAttribute('href');
    await screen.findByRole('group', { name: 'Actions for 01 - Two.flac' });
    expect(searchLink('01 - Two.flac')).toBe('/music/album/32/search?title=Second+Album&instance=lid-2');
    expect(searchLink('01 - One.flac')).toBe('/music/album/31/search?title=First+Album&instance=lid-2');
  });

  it('offers no Interactive search to a user who cannot manage activity', async () => {
    mocks.canManageActivity = false;
    renderPage();
    const actions = await screen.findByRole('group', { name: 'Actions for 01 - Two.flac' });
    expect(within(actions).queryByRole('link', { name: 'Interactive search…' })).toBeNull();
    expect(within(actions).getByRole('button', { name: 'View information' })).toBeTruthy();
  });
});
