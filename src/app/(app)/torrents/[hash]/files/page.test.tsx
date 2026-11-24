// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HASH = 'a'.repeat(40);
const mocks = vi.hoisted(() => ({
  asked: [] as string[],
  canManage: true,
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ hash: 'a'.repeat(40) }),
  useSearchParams: () => new URLSearchParams('name=Pack'),
  usePathname: () => `/torrents/${'a'.repeat(40)}/files`,
}));
vi.mock('@/components/permission-provider', () => ({ useCan: () => mocks.canManage }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/lib/client-refresh-settings', () => ({ getRefreshIntervalMs: vi.fn(async () => 5_000) }));
vi.mock('@/components/ui/quick-context-menu', () => ({ QuickContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('sonner', () => ({ toast: mocks.toast }));

import { resetRouteViewStateForTests } from '@/lib/hooks/use-route-view-state';
import TorrentFilesPage from './page';

const file = (index: number, name: string) => ({ index, name, size: 1024, progress: 0.5, priority: 1, is_seed: false, availability: 1 });

let files: ReturnType<typeof file>[];
let posts: Record<string, unknown>[];
let answer: (body: Record<string, unknown>) => Response;

beforeEach(() => {
  // Open folders are kept per route; each test starts with them closed.
  sessionStorage.clear();
  resetRouteViewStateForTests();
  mocks.asked = [];
  mocks.canManage = true;
  files = [file(0, 'Pack/one.mkv'), file(1, 'Pack/two.mkv')];
  posts = [];
  answer = () => Response.json({ success: true });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    mocks.asked.push(url.pathname);
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push(body);
      return answer(body);
    }
    return Response.json({ files });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><TorrentFilesPage /></QueryClientProvider>);
};

const startRename = async (name: string) => {
  await userEvent.click(await screen.findByRole('button', { name: `More actions for ${name}` }));
  await userEvent.click(await screen.findByRole('menuitem', { name: /Rename/ }));
};

describe('torrent files page', () => {
  it('reads the file list from the files route, not the heavier details route', async () => {
    renderPage();

    expect(await screen.findByText('Pack')).toBeTruthy();
    await waitFor(() => expect(mocks.asked).toContain(`/api/qbittorrent/${HASH}/files`));
    expect(mocks.asked.every((path) => path === `/api/qbittorrent/${HASH}/files`)).toBe(true);
  });

  it('offers no rename without torrents.manage', async () => {
    mocks.canManage = false;
    renderPage();
    expect(await screen.findByText('Pack')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
  });

  it('renames a folder by its path and a new name, and keeps it open under the new one', async () => {
    answer = (body) => {
      files = [file(0, 'The Pack/one.mkv'), file(1, 'The Pack/two.mkv')];
      return Response.json({ success: true, path: body.name });
    };
    renderPage();
    // Open the folder first: it should stay open after the rename.
    await userEvent.click(await screen.findByText('Pack'));
    expect(await screen.findByText('one.mkv')).toBeTruthy();

    await startRename('Pack');
    const field = screen.getByRole('textbox', { name: 'New folder name' });
    await userEvent.clear(field);
    await userEvent.type(field, 'The Pack{Enter}');

    await waitFor(() => expect(posts).toEqual([{ kind: 'folder', path: 'Pack', name: 'The Pack', confirm: false }]));
    expect(await screen.findByText('The Pack')).toBeTruthy();
    expect(await screen.findByText('one.mkv')).toBeTruthy();
    expect(mocks.toast.success).toHaveBeenCalledWith('Renamed to The Pack');
  });

  it("selects a file's name up to its extension and keeps Rename off until it changes", async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Pack'));
    await startRename('one.mkv');
    const field = screen.getByRole('textbox', { name: 'New file name' }) as HTMLInputElement;
    expect(field.value).toBe('one.mkv');
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 3]);
    expect((screen.getByRole('button', { name: 'Rename' }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.keyboard('uno');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(posts).toEqual([{ kind: 'file', path: 'Pack/one.mkv', name: 'uno.mkv', confirm: false }]));
  });

  it('warns when an arr downloads into the category, and renames only once confirmed', async () => {
    answer = (body) => (body.confirm
      ? Response.json({ success: true, path: 'Pack/uno.mkv' })
      : Response.json(
          { error: 'needs confirm', needsConfirm: true, category: 'tv', uses: [{ app: 'Sonarr', instance: 'Sonarr Anime' }], unchecked: [] },
          { status: 409 },
        ));
    renderPage();
    await userEvent.click(await screen.findByText('Pack'));
    await startRename('one.mkv');
    await userEvent.keyboard('uno{Enter}');

    expect(await screen.findByText('Sonarr (Sonarr Anime) downloads into tv.')).toBeTruthy();
    expect(mocks.toast.error).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Rename Anyway' }));
    await waitFor(() => expect(posts.map((post) => post.confirm)).toEqual([false, true]));
    expect(mocks.toast.success).toHaveBeenCalledWith('Renamed to uno.mkv');
  });

  it("shows the server's refusal and keeps the editor open to fix the name", async () => {
    answer = () => Response.json({ error: 'There is already a file or folder named two.mkv there' }, { status: 409 });
    renderPage();
    await userEvent.click(await screen.findByText('Pack'));
    await startRename('one.mkv');
    await userEvent.keyboard('two{Enter}');

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('There is already a file or folder named two.mkv there'));
    expect(screen.getByRole('textbox', { name: 'New file name' })).toBeTruthy();
  });

  it('cancels with Escape', async () => {
    renderPage();
    await startRename('Pack');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'New folder name' })).toBeNull();
    expect(posts).toEqual([]);
  });
});
