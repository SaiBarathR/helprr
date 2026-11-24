// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  me: { role: 'admin' } as { role: string } | null,
  back: vi.fn(),
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/components/permission-provider', () => ({ useMe: () => mocks.me }));
vi.mock('@/components/layout/navigation-provider', () => ({
  useAppRouter: () => ({ back: mocks.back, push: mocks.push }),
  canGoBackInApp: () => true,
}));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock('@/lib/query-client', () => ({ handleAuthError: vi.fn() }));
vi.mock('sonner', () => ({ toast: mocks.toast }));

import TorrentCategoriesPage from './page';
import { CategoryForm } from '../_components/category-form';

const DETAILS = {
  categories: {
    tv: { name: 'tv', savePath: '/downloads/tv' },
    anime: { name: 'anime', savePath: '' },
  },
  defaultSavePath: '/downloads/',
  subcategories: false,
  autoTmmByDefault: false,
  categoryPathsInManualMode: false,
  relocateOnCategoryPathChange: false as boolean | null,
};
let details = DETAILS;

let calls: { method: string; body: Record<string, unknown> }[];
let respond: (method: string, body: Record<string, unknown>) => Response;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.me = { role: 'admin' };
  details = DETAILS;
  calls = [];
  respond = () => Response.json({ success: true });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (!init?.method || init.method === 'GET') {
      expect(url).toBe('/api/qbittorrent/categories?details=1');
      return Response.json(details);
    }
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ method: init.method, body });
    return respond(init.method, body);
  }));
});

const renderWithQuery = (ui: ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe('Categories screen', () => {
  it('lists the categories with their folders, each a link to edit it, for an admin', async () => {
    renderWithQuery(<TorrentCategoriesPage />);
    expect(await screen.findByText('/downloads/anime (default)')).toBeTruthy();
    expect(screen.getByText('/downloads/tv')).toBeTruthy();
    const names = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(names).toEqual([
      '/torrents/categories/edit?name=anime',
      '/torrents/categories/edit?name=tv',
      '/torrents/categories/new',
    ]);
  });

  it('shows a subcategory\'s default folder under its parent\'s folder in subcategory mode', async () => {
    const details = {
      categories: { tv: { name: 'tv', savePath: '/data/tv' }, 'tv/anime': { name: 'tv/anime', savePath: '' } },
      defaultSavePath: '/downloads',
      subcategories: true,
    };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(details)));
    renderWithQuery(<TorrentCategoriesPage />);
    expect(await screen.findByText('/data/tv/anime (default)')).toBeTruthy();
  });

  it('only lists them for a member', async () => {
    mocks.me = { role: 'member' };
    renderWithQuery(<TorrentCategoriesPage />);
    expect(await screen.findByText('/downloads/tv')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.getByText('Only an admin can add, change or remove categories.')).toBeTruthy();
  });
});

describe('Category form', () => {
  it('creates a category and goes back', async () => {
    const user = userEvent.setup();
    renderWithQuery(<CategoryForm />);
    await user.type(await screen.findByLabelText('Category name'), 'music');
    await user.type(screen.getByLabelText('Save path'), '/downloads/music');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mocks.back).toHaveBeenCalled());
    expect(calls).toEqual([{ method: 'POST', body: { name: 'music', savePath: '/downloads/music' } }]);
  });

  it('shows the refusal under the field it is about and stays on the page', async () => {
    const PATH_ERROR = "The save path must be inside qBittorrent's default save path (/downloads)";
    respond = () => Response.json({ error: PATH_ERROR, field: 'savePath' }, { status: 400 });
    const user = userEvent.setup();
    renderWithQuery(<CategoryForm />);
    await user.type(await screen.findByLabelText('Category name'), 'music');
    await user.type(screen.getByLabelText('Save path'), '/etc');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(PATH_ERROR);
    const field = screen.getByLabelText('Save path');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe(alert.id);
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(mocks.back).not.toHaveBeenCalled();

    // Typing in the other field leaves it; typing in its own clears it.
    await user.type(screen.getByLabelText('Category name'), 's');
    expect(screen.getByRole('alert').textContent).toBe(PATH_ERROR);
    await user.type(field, 'x');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a name refusal under the name, and one about neither field above the buttons', async () => {
    respond = () => Response.json({ error: 'There is already a category named tv', field: 'name' }, { status: 409 });
    const user = userEvent.setup();
    renderWithQuery(<CategoryForm />);
    const name = await screen.findByLabelText('Category name');
    await user.type(name, 'tv');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect((await screen.findByRole('alert')).id).toBe(name.getAttribute('aria-describedby'));

    respond = () => Response.json({ error: 'Failed to create the category' }, { status: 502 });
    await user.type(name, '2');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Failed to create the category');
    expect(name.getAttribute('aria-invalid')).toBeNull();
  });

  it.each([
    [true, /moves its torrents under automatic management there\. Torrents under manual management stay/],
    [false, /doesn't move its torrents: qBittorrent switches those under automatic management to manual management/],
    [null, /unless qBittorrent is set to switch them to manual management/],
  ])('says what saving a new folder does when qBittorrent relocates: %s', async (relocate, text) => {
    details = { ...DETAILS, relocateOnCategoryPathChange: relocate };
    renderWithQuery(<CategoryForm editName="tv" />);
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it('warns of the arr that uses a category before removing it anyway', async () => {
    respond = (_method, body) => (body.confirm
      ? Response.json({ success: true })
      : Response.json({
        error: 'in use',
        needsConfirm: true,
        uses: [{ app: 'Sonarr', instance: 'Sonarr Anime', downloadClient: 'qBittorrent', category: 'tv' }],
        unchecked: ['Radarr'],
      }, { status: 409 }));
    const user = userEvent.setup();
    renderWithQuery(<CategoryForm editName="tv" />);
    await user.click(await screen.findByRole('button', { name: 'Remove Category' }));
    expect(await screen.findByText('Torrents in it lose the category. Their files stay where they are.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Sonarr (Sonarr Anime) uses tv in its download client qBittorrent.')).toBeTruthy();
    expect(screen.getByText('Did not answer, so not checked: Radarr.')).toBeTruthy();
    // The dialog the admin confirms still says what happens to the torrents.
    expect(screen.getByText('Torrents in it lose the category. Their files stay where they are.')).toBeTruthy();
    expect(mocks.back).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove Anyway' }));
    await waitFor(() => expect(mocks.back).toHaveBeenCalled());
    expect(calls).toEqual([
      { method: 'DELETE', body: { categories: ['tv'], confirm: false } },
      { method: 'DELETE', body: { categories: ['tv'], confirm: true } },
    ]);
  });

  it('refuses a member', async () => {
    mocks.me = { role: 'member' };
    renderWithQuery(<CategoryForm editName="tv" />);
    expect(screen.getByText('Only an admin can change categories.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove Category' })).toBeNull();
  });
});
