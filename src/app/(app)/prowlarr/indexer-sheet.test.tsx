// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IndexerSheet } from './indexer-sheet';
import type { IndexerActions } from './use-indexer-actions';
import type { ProwlarrIndexerSummary } from '@/lib/prowlarr-client';

vi.mock('@/components/ui/drawer', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Drawer: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? <div>{children}</div> : null),
    DrawerContent: Pass, DrawerHeader: Pass, DrawerTitle: Pass, DrawerDescription: Pass,
  };
});

const indexer: ProwlarrIndexerSummary = {
  id: 7, name: 'YTS', enable: true, protocol: 'torrent', privacy: 'public', priority: 25,
  implementationName: 'Cardigann', tags: [], appProfileId: 1, categories: ['Movies', 'TV'],
};

function actions(): IndexerActions {
  return {
    testingId: null, deletingId: null, confirmDelete: null, pendingEdits: new Map(),
    setConfirmDelete: vi.fn(), handleTest: vi.fn(), handleEdit: vi.fn(), handleToggle: vi.fn(), handleDelete: vi.fn(),
  };
}

function renderSheet(props: Partial<Parameters<typeof IndexerSheet>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const shared = actions();
  render(
    <QueryClientProvider client={client}>
      <IndexerSheet indexer={indexer} statuses={[]} canManage actions={shared} onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
  return shared;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    String(url).startsWith('/api/prowlarr/tags') ? [{ id: 1, label: 'anime' }, { id: 2, label: 'private' }]
    : String(url).startsWith('/api/prowlarr/appprofile') ? [{ id: 1, name: 'Standard' }, { id: 2, name: 'Interactive' }]
    : String(url).startsWith('/api/prowlarr/stats')
      ? { indexers: [{ indexerId: 7, indexerName: 'YTS', averageResponseTime: 412.4, numberOfQueries: 10, numberOfRssQueries: 5, numberOfAuthQueries: 0, numberOfGrabs: 3, numberOfFailedQueries: 1, numberOfFailedRssQueries: 1 }], userAgents: [], hosts: [] }
      : { records: [{ id: 1, indexerId: 7, eventType: 'indexerQuery', successful: false, date: '2026-10-30T00:00:00Z', data: { query: 'big buck bunny' } }] },
  ))));
});

describe('IndexerSheet', () => {
  it('shows this indexer\'s numbers, recent activity and categories, fetching only its history', async () => {
    renderSheet();

    expect(await screen.findByText('412 ms')).toBeTruthy();
    expect(screen.getByText('15')).toBeTruthy();
    expect(await screen.findByText('big buck bunny')).toBeTruthy();
    expect(screen.getByText('Failed', { selector: 'span[data-slot="badge"], span' })).toBeTruthy();
    expect(screen.getByText('Categories (2)')).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.map((call) => String(call[0]))).toContain('/api/prowlarr/history?indexerId=7&pageSize=10');
  });

  it('hides the actions from users who cannot manage', () => {
    renderSheet({ canManage: false });

    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Test' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete YTS' })).toBeNull();
  });

  it('runs the shared actions', async () => {
    const shared = renderSheet();

    await userEvent.click(screen.getByRole('switch', { name: 'YTS enabled' }));
    await userEvent.click(screen.getByRole('button', { name: 'Test' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete YTS' }));

    expect(shared.handleToggle).toHaveBeenCalledWith(indexer, false);
    expect(shared.handleTest).toHaveBeenCalledWith(7);
    expect(shared.setConfirmDelete).toHaveBeenCalledWith({ id: 7, name: 'YTS' });
  });

  it('steps the priority and stops at the limits', async () => {
    const shared = renderSheet();

    await userEvent.click(screen.getByRole('button', { name: 'Raise the priority number' }));
    expect(shared.handleEdit).toHaveBeenCalledWith(indexer, { priority: 26 }, expect.any(String));

    cleanup();
    renderSheet({ indexer: { ...indexer, priority: 50 } });
    expect((screen.getByRole('button', { name: 'Raise the priority number' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    renderSheet({ indexer: { ...indexer, priority: 1 } });
    expect((screen.getByRole('button', { name: 'Lower the priority number' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds or removes one tag at a time and shows names', async () => {
    const shared = renderSheet({ indexer: { ...indexer, tags: [2] } });

    await userEvent.click(await screen.findByRole('button', { name: 'anime' }));
    expect(shared.handleEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 7 }), { tags: [2, 1] }, expect.any(String), { tags: [1], applyTags: 'add' },
    );

    await userEvent.click(screen.getByRole('button', { name: 'private' }));
    expect(shared.handleEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 7 }), { tags: [] }, expect.any(String), { tags: [2], applyTags: 'remove' },
    );
  });

  it('locks the edit controls while a save is pending', async () => {
    const shared = actions();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <IndexerSheet
          indexer={indexer}
          statuses={[]}
          canManage
          actions={{ ...shared, pendingEdits: new Map([[7, { priority: 26 }]]) }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect((screen.getByRole('button', { name: 'Raise the priority number' }) as HTMLButtonElement).disabled).toBe(true);
    expect((await screen.findByRole('button', { name: 'anime' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows settings as text to users who cannot manage', async () => {
    renderSheet({ canManage: false, indexer: { ...indexer, tags: [2] } });

    expect(await screen.findByText('Standard')).toBeTruthy();
    expect(await screen.findByText('private')).toBeTruthy();
    expect(screen.queryByText('anime')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Raise the priority number' })).toBeNull();
  });

  it('fetches nothing while closed', () => {
    renderSheet({ indexer: null });

    expect(fetch).not.toHaveBeenCalled();
  });
});
