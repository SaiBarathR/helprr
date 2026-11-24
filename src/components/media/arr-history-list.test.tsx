// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryItem } from '@/types';

const mocks = vi.hoisted(() => ({
  canManage: true,
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/components/permission-provider', () => ({
  useCan: (cap: string) => cap !== 'activity.manage' || mocks.canManage,
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/components/ui/drawer', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Drawer: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
    DrawerContent: Pass, DrawerHeader: Pass, DrawerTitle: Pass, DrawerDescription: Pass, DrawerClose: Pass,
  };
});
vi.mock('@/components/ui/quick-context-menu', () => ({
  QuickContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { ArrHistoryList } from './arr-history-list';

const event = (extra: Partial<HistoryItem>): HistoryItem => ({
  id: 41,
  sourceTitle: 'Alien.1979.1080p.BluRay',
  eventType: 'grabbed',
  date: '2026-11-20T10:00:00Z',
  quality: { quality: { name: 'Bluray-1080p' } },
  qualityCutoffNotMet: false,
  downloadId: 'ABC',
  data: {},
  ...extra,
});

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  void url; void init;
  return Response.json({ success: true });
});

beforeEach(() => {
  mocks.canManage = true;
  mocks.toast.success.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

function renderList(items: HistoryItem[], { instanceId }: { instanceId?: string } = { instanceId: 'rad-4k' }) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <ArrHistoryList items={items} loading={false} source="radarr" instanceId={instanceId} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), invalidate };
}

describe("a title's own history: mark as failed", () => {
  it("fails a grab on the title's instance after a confirm, as Activity does", async () => {
    const { user, invalidate } = renderList([event({})]);
    await user.click(screen.getByText('Alien.1979.1080p.BluRay'));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark as failed' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Radarr will blocklist this release and search for another one.')).toBeTruthy();

    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Mark as failed' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Marked as failed'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/activity/history/41/failed');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ source: 'radarr', instanceId: 'rad-4k' });
    // The sheet closes; the title's history and Activity (with the title's blocklist) refresh.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['radarr', 'history'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['activity'] });
  });

  it('offers it only on a grab or an import of a download', async () => {
    for (const item of [
      event({ eventType: 'downloadFailed' }),
      event({ eventType: 'movieFileDeleted' }),
      event({ eventType: 'downloadFolderImported', downloadId: undefined }),
    ]) {
      const { user } = renderList([item]);
      await user.click(screen.getByText(item.sourceTitle));
      expect(screen.queryByRole('button', { name: 'Mark as failed' })).toBeNull();
      cleanup();
    }
    const { user } = renderList([event({ eventType: 'downloadFolderImported' })]);
    await user.click(screen.getByText('Alien.1979.1080p.BluRay'));
    expect(screen.getByRole('button', { name: 'Mark as failed' })).toBeTruthy();
  });

  it('waits for the instance to be known', async () => {
    const { user } = renderList([event({})], {});
    await user.click(screen.getByText('Alien.1979.1080p.BluRay'));
    expect(screen.queryByRole('button', { name: 'Mark as failed' })).toBeNull();
  });

  it('is hidden from a member without activity.manage', async () => {
    mocks.canManage = false;
    const { user } = renderList([event({})]);
    await user.click(screen.getByText('Alien.1979.1080p.BluRay'));
    expect(screen.queryByRole('button', { name: 'Mark as failed' })).toBeNull();
  });
});
