// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockContextAction = { id: string; label: string; onSelect?: () => void };

const mocks = vi.hoisted(() => ({
  search: 'instance=lid-2',
  dialog: null as null | { open: boolean; title: string; service: string; searchParams: Record<string, unknown> },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '9' }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
// Each file row's quick actions as plain buttons beside it.
vi.mock('@/components/ui/quick-context-menu', () => ({
  QuickContextMenu: ({ children, label, actions }: { children: React.ReactNode; label: string; actions: MockContextAction[] }) => (
    <>
      {children}
      <div role="group" aria-label={label}>
        {actions.map((action) => <button key={action.id} type="button" onClick={action.onSelect}>{action.label}</button>)}
      </div>
    </>
  ),
}));
vi.mock('@/components/media/interactive-search-dialog', () => ({
  InteractiveSearchDialog: (props: NonNullable<typeof mocks.dialog>) => {
    mocks.dialog = props;
    return props.open ? <div role="dialog" aria-label={props.title} /> : null;
  },
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
  mocks.dialog = null;
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
    const user = userEvent.setup();
    renderPage();
    await user.click(within(await screen.findByRole('group', { name: 'Actions for 01 - Two.flac' })).getByRole('button', { name: 'Interactive search…' }));
    expect(screen.getByRole('dialog', { name: 'Second Album' })).toBeTruthy();
    expect(mocks.dialog).toEqual(expect.objectContaining({ service: 'lidarr', searchParams: { albumId: 32, instanceId: 'lid-2' } }));

    await user.click(within(screen.getByRole('group', { name: 'Actions for 01 - One.flac' })).getByRole('button', { name: 'Interactive search…' }));
    expect(screen.getByRole('dialog', { name: 'First Album' })).toBeTruthy();
    expect(mocks.dialog?.searchParams).toEqual({ albumId: 31, instanceId: 'lid-2' });
  });
});
