// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/components/ui/drawer', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Drawer: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
    DrawerContent: Pass, DrawerHeader: Pass, DrawerTitle: Pass,
  };
});
vi.mock('@/components/ui/quick-context-menu', () => ({
  QuickContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { TitleBlocklist } from './title-blocklist';

const ENTRY = {
  id: 12, sourceTitle: 'Kusuriya no Hitorigoto - S03E06 [1080p]', date: '2026-11-04T16:07:25Z',
  indexer: 'Shana Project (Prowlarr)', protocol: 'torrent', message: 'Manually marked as failed',
  source: 'sonarr', instanceId: 'son-1', instanceLabel: 'Anime',
};

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  void init;
  if (url.startsWith('/api/activity/blocklist/title')) return Response.json({ records: [ENTRY], truncated: false });
  return Response.json({ success: true, removed: 1 });
});

beforeEach(() => {
  fetchMock.mockClear();
  mocks.toast.success.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

function renderList(instanceId: string | undefined) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TitleBlocklist source="sonarr" mediaId={214} instanceId={instanceId} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe("a title's blocklist", () => {
  it('removes an entry through the Activity blocklist route, naming its instance', async () => {
    const user = renderList('son-1');
    await user.click(await screen.findByText(ENTRY.sourceTitle));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Remove from blocklist/ }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Removed from blocklist'));
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'DELETE')!;
    expect(url).toBe('/api/activity/blocklist');
    expect(JSON.parse(String(init?.body))).toEqual({ source: 'sonarr', instanceId: 'son-1', ids: [12] });
    // The list is read again so the entry goes away.
    await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => u.startsWith('/api/activity/blocklist/title'))).toHaveLength(2));
  });

  it('reads nothing until the instance is known', async () => {
    renderList(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Blocklist')).toBeNull();
  });
});
