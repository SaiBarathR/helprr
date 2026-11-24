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
};

let calls: { method: string; body: Record<string, unknown> }[];
let respond: (method: string, body: Record<string, unknown>) => Response;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.me = { role: 'admin' };
  calls = [];
  respond = () => Response.json({ success: true });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (!init?.method || init.method === 'GET') {
      expect(url).toBe('/api/qbittorrent/categories?details=1');
      return Response.json(DETAILS);
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

  it('shows the refusal and stays on the page', async () => {
    respond = () => Response.json({ error: "The save path must be inside qBittorrent's default save path (/downloads)" }, { status: 400 });
    const user = userEvent.setup();
    renderWithQuery(<CategoryForm />);
    await user.type(await screen.findByLabelText('Category name'), 'music');
    await user.type(screen.getByLabelText('Save path'), '/etc');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("The save path must be inside qBittorrent's default save path (/downloads)"));
    expect(mocks.back).not.toHaveBeenCalled();
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
