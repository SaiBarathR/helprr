// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { LibraryCommandsMenu } from './library-commands-menu';

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  pollCommand: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/lib/arr-command', () => ({ pollCommand: mocks.pollCommand }));

let posts: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  posts = [];
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  mocks.pollCommand.mockResolvedValue('completed');
});

function renderMenu(instances: Array<{ id: string; label: string; type: string }>, reply = () => Response.json({ id: 9, name: 'RssSync', status: 'queued' })) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/instances') return Response.json(instances);
    posts.push({ url, body: JSON.parse(String(init?.body)) });
    return reply();
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><LibraryCommandsMenu service="radarr" /></QueryClientProvider>);
}

it('runs a command on the one instance, follows it, and says when it is done', async () => {
  renderMenu([{ id: 'rad-1', label: 'radarr-anime', type: 'RADARR' }, { id: 'son-1', label: 'main', type: 'SONARR' }]);
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
  const menu = await screen.findByRole('menu');
  // A single instance needs no group name.
  expect(within(menu).queryByText('radarr-anime')).toBeNull();
  expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent))
    .toEqual(['RSS Sync', 'Refresh all movies', 'Refresh collections']);
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'RSS Sync' }));
  await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('RSS Sync finished'));
  expect(posts).toEqual([{ url: '/api/radarr/library-command?instanceId=rad-1', body: { name: 'RssSync' } }]);
  expect(mocks.toast.success).toHaveBeenCalledWith('RSS Sync started');
  expect(mocks.pollCommand).toHaveBeenCalledWith('radarr', 9, 'rad-1');
});

it('names the instance when there are several, and shows the server\'s refusal', async () => {
  renderMenu(
    [{ id: 'rad-1', label: 'main', type: 'RADARR' }, { id: 'rad-2', label: 'radarr-anime', type: 'RADARR' }],
    () => Response.json({ error: 'Forbidden' }, { status: 403 }),
  );
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
  const menu = await screen.findByRole('menu');
  expect(within(menu).getByText('main (Radarr)')).toBeTruthy();
  await userEvent.click(within(menu).getAllByRole('menuitem', { name: 'Refresh all movies' })[1]);
  await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Refresh all movies failed on radarr-anime', { description: 'Forbidden' }));
  expect(posts).toEqual([{ url: '/api/radarr/library-command?instanceId=rad-2', body: { name: 'RefreshMovie' } }]);
  expect(mocks.pollCommand).not.toHaveBeenCalled();
});

it('shows nothing when there is no instance and no page item', async () => {
  renderMenu([]);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
});
