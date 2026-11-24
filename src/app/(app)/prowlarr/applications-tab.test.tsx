// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApplicationsTab } from './applications-tab';

const perms = vi.hoisted(() => ({ canManage: false, role: 'member' }));
vi.mock('@/components/permission-provider', () => ({
  useCan: () => perms.canManage,
  useMe: () => ({ role: perms.role }),
}));
vi.mock('@/components/ui/drawer', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Drawer: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
    DrawerContent: Pass, DrawerHeader: Pass, DrawerTitle: Pass, DrawerDescription: Pass, DrawerFooter: Pass,
  };
});

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => new Response(JSON.stringify(
  url === '/api/prowlarr/tags'
    ? [{ id: 1, label: 'anime' }, { id: 2, label: 'unused' }]
    : url.startsWith('/api/prowlarr/applications/from-connection')
      ? { implementation: 'Sonarr', name: 'sonarr-anime', baseUrl: 'http://192.168.0.124:8990', prowlarrUrl: 'http://prowlarr:9696' }
      : url === '/api/prowlarr/applications'
        ? {
          applications: [{ id: 5, name: 'Sonarr', implementationName: 'Sonarr', syncLevel: 'addOnly', enable: true, tags: [1, 9] }],
          unsynced: [{ id: 'conn-anime', type: 'SONARR', label: 'sonarr-anime' }],
        }
        : { ok: true },
)));

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ApplicationsTab /></QueryClientProvider>);
}

const writes = () => fetchMock.mock.calls
  .filter(([, init]) => init?.method && init.method !== 'GET')
  .map(([url, init]) => [url, init?.method, init?.body ? JSON.parse(String(init.body)) : undefined]);

beforeEach(() => {
  perms.canManage = false;
  perms.role = 'member';
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('ApplicationsTab', () => {
  it('names the tags on each app, leaving out ones Prowlarr no longer has', async () => {
    renderTab();
    expect(await screen.findByText('anime')).toBeTruthy();
    expect(screen.queryByText('unused')).toBeNull();
    expect(screen.queryByText('9')).toBeNull();
  });

  it('offers Add to Prowlarr to an admin only', async () => {
    perms.canManage = true;
    renderTab();
    await screen.findByText(/sonarr-anime may not be synced/);
    expect(screen.queryByRole('button', { name: 'Add sonarr-anime to Prowlarr' })).toBeNull();
  });

  it('adds an unsynced arr from Helprr’s guesses, sending no key', async () => {
    perms.canManage = true;
    perms.role = 'admin';
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'Add sonarr-anime to Prowlarr' }));
    const sheet = await screen.findByRole('dialog');
    expect((await within(sheet).findByLabelText('Prowlarr reaches sonarr-anime at') as HTMLInputElement).value).toBe('http://192.168.0.124:8990');
    expect((within(sheet).getByLabelText('sonarr-anime reaches Prowlarr at') as HTMLInputElement).value).toBe('http://prowlarr:9696');

    await userEvent.click(within(sheet).getByRole('button', { name: 'Add' }));
    expect(writes()).toEqual([[
      '/api/prowlarr/applications/from-connection',
      'POST',
      { connectionId: 'conn-anime', name: 'sonarr-anime', baseUrl: 'http://192.168.0.124:8990', prowlarrUrl: 'http://prowlarr:9696', syncLevel: 'fullSync', testOnly: false },
    ]]);
  });

  it('asks before switching an app to full sync, then saves only the sync level', async () => {
    perms.canManage = true;
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'Sonarr' }));
    await userEvent.click(screen.getByRole('radio', { name: /Full sync/ }));
    expect(writes()).toEqual([]);
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText(/remove indexers from Sonarr/)).toBeTruthy();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Use full sync' }));
    expect(writes()).toEqual([['/api/prowlarr/applications/bulk', 'PUT', { ids: [5], syncLevel: 'fullSync' }]]);
  });

  it('turns sync off at once, and changes one tag at a time', async () => {
    perms.canManage = true;
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'Sonarr' }));
    await userEvent.click(screen.getByRole('radio', { name: /Sync off/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'anime', pressed: true }));
    expect(writes()).toEqual([
      ['/api/prowlarr/applications/bulk', 'PUT', { ids: [5], syncLevel: 'disabled' }],
      ['/api/prowlarr/applications/bulk', 'PUT', { ids: [5], tags: [1], applyTags: 'remove' }],
    ]);
  });

  it('syncs all apps, forced only when asked', async () => {
    perms.canManage = true;
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'Sync All' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Force' }));
    await userEvent.click(screen.getByRole('button', { name: 'Force sync' }));
    expect(writes()).toEqual([['/api/prowlarr/command', 'POST', { name: 'ApplicationIndexerSync', forceSync: true }]]);
  });
});
