// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canManage: true,
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/components/permission-provider', () => ({ useCan: () => mocks.canManage, useMe: () => ({ role: 'member' }) }));
vi.mock('@/components/layout/navigation-provider', () => ({
  useAppRouter: () => ({ back: vi.fn(), push: vi.fn() }),
  canGoBackInApp: () => true,
}));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock('@/lib/query-client', () => ({ handleAuthError: vi.fn() }));
vi.mock('sonner', () => ({ toast: mocks.toast }));

import TorrentTagsPage from './page';

let tags: { name: string; torrents: number }[];
let calls: { method: string; body: Record<string, unknown> }[];
let respond: () => Response;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canManage = true;
  tags = [{ name: 'seed', torrents: 3 }, { name: 'keep', torrents: 1 }, { name: 'unused', torrents: 0 }];
  calls = [];
  respond = () => Response.json({ success: true });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('/api/qbittorrent/tags');
    if (!init?.method || init.method === 'GET') return Response.json({ tags });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ method: init.method, body });
    return respond();
  }));
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TorrentTagsPage />
    </QueryClientProvider>,
  );

describe('Tags screen', () => {
  it('lists the tags by name with their torrent counts', async () => {
    renderPage();
    expect(await screen.findByText('3 torrents')).toBeTruthy();
    expect(screen.getByText('1 torrent')).toBeTruthy();
    expect(screen.getByText('0 torrents')).toBeTruthy();
    const names = screen.getAllByRole('button', { name: /^Delete / }).map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Delete keep', 'Delete seed', 'Delete unused']);
  });

  it('only lists them without torrents.manage', async () => {
    mocks.canManage = false;
    renderPage();
    expect(await screen.findByText('3 torrents')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    expect(screen.queryByLabelText('Tag name')).toBeNull();
    expect(screen.getByText('Only users who may manage torrents can add or delete tags.')).toBeTruthy();
  });

  it('creates a trimmed tag', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText('Tag name'), '  fresh ');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls).toEqual([{ method: 'POST', body: { name: 'fresh' } }]));
    expect(mocks.toast.success).toHaveBeenCalledWith('Created fresh');
  });

  it.each([
    ['a comma', 'a,b', "A tag can't contain a comma"],
    ['a tag that exists', 'seed', 'There is already a tag named seed'],
  ])('refuses %s before sending', async (_label, value, message) => {
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText('Tag name'), value);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(calls).toEqual([]);
  });

  it('shows the server refusal under the field', async () => {
    respond = () => Response.json({ error: 'A tag needs 1 to 100 characters and no comma' }, { status: 400 });
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText('Tag name'), 'x');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect((await screen.findByRole('alert')).textContent).toBe('A tag needs 1 to 100 characters and no comma');
  });

  it('confirms a delete with how many torrents lose the tag', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Delete seed' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete seed?')).toBeTruthy();
    expect(within(dialog).getByText('It is removed from 3 torrents. The torrents and their files stay.')).toBeTruthy();
    expect(calls).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls).toEqual([{ method: 'DELETE', body: { tags: ['seed'] } }]));
    expect(mocks.toast.success).toHaveBeenCalledWith('Deleted seed');
  });

  it('says when no torrent has the tag', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Delete unused' }));
    expect(within(await screen.findByRole('alertdialog')).getByText('No torrent has this tag.')).toBeTruthy();
  });
});
