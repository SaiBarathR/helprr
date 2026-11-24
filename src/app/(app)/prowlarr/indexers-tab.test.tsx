// @vitest-environment jsdom
// The Indexers tab's search, filters and sort (over the loaded list, kept in
// the UI store), Select mode with its bulk actions, and the health banner's
// Re-check, driven on the real page with a stubbed fetch.
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  caps: new Set<string>(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
  pollCommand: vi.fn(),
  health: [] as Array<{ source: string; type: string; message: string; wikiUrl: string }>,
  sent: [] as Array<{ method: string; path: string; body: unknown }>,
  respond: {} as Record<string, (body: unknown) => Response>,
}));

vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap) }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/hooks/use-route-view-state', () => ({ useRouteViewState: <T,>(_name: string, initial: T) => useState<T>(initial) }));
vi.mock('@/lib/hooks/use-search-history', () => ({ useSearchHistory: () => ({ recent: [], add: vi.fn(), remove: vi.fn() }) }));
vi.mock('@/lib/arr-command', () => ({ pollCommand: mocks.pollCommand }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/components/ui/pull-to-refresh', () => ({ PullToRefresh: () => null }));
vi.mock('@/components/layout/page-title', () => ({ PageTitle: () => null }));
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));
// Menus as plain buttons: the trigger, then the items.
vi.mock('@/components/ui/responsive-menu', () => ({
  ResponsiveMenu: ({ trigger, title, children }: { trigger: React.ReactNode; title: string; children: React.ReactNode }) => (
    <div>{trigger}<div role="menu" aria-label={title}>{children}</div></div>
  ),
  ResponsiveMenuCheckboxItem: ({ children, checked, onCheckedChange }: { children: React.ReactNode; checked: boolean; onCheckedChange: () => void }) => (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} onClick={onCheckedChange}>{children}</button>
  ),
  ResponsiveMenuLabel: ({ children }: { children: React.ReactNode }) => <div role="presentation">{children}</div>,
  ResponsiveMenuSeparator: () => <hr />,
  ResponsiveMenuActionItem: ({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) => (
    <button type="button" role="menuitem" onClick={onSelect}>{children}</button>
  ),
  ResponsiveMenuSortDirection: ({ value, onChange }: { value: 'asc' | 'desc'; onChange: (dir: 'asc' | 'desc') => void }) => (
    <div role="group" aria-label="Sort direction">
      <button type="button" aria-pressed={value === 'asc'} onClick={() => onChange('asc')}>Ascending</button>
      <button type="button" aria-pressed={value === 'desc'} onClick={() => onChange('desc')}>Descending</button>
    </div>
  ),
}));
type MockAction = { id: string; label: string; onSelect?: () => void };
vi.mock('@/components/ui/quick-context-menu', () => ({
  QuickContextMenu: ({ children, label, groups, disabled }: { children: React.ReactNode; label: string; disabled?: boolean; groups?: Array<{ actions: MockAction[] }> }) => (
    <>
      {children}
      {!disabled && (
        <div role="group" aria-label={label}>
          {(groups ?? []).flatMap((group) => group.actions).map((action) => (
            <button key={action.id} type="button" onClick={action.onSelect}>{action.label}</button>
          ))}
        </div>
      )}
    </>
  ),
}));

import ProwlarrPage from './page';
import { useUIStore } from '@/lib/store';
import { DEFAULT_PROWLARR_INDEXER_VIEW } from '@/lib/prowlarr-indexer-view';

// jsdom lacks these; vaul and Radix call them.
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.hasPointerCapture ??= () => false;
Element.prototype.scrollIntoView ??= () => {};

const INDEXERS = [
  { id: 1, name: 'YTS', enable: true, protocol: 'torrent', privacy: 'public', priority: 25, implementationName: 'YTS', tags: [], appProfileId: 1, added: '2025-01-01T00:00:00Z', categories: [] },
  { id: 2, name: 'Nyaa', enable: false, protocol: 'torrent', privacy: 'public', priority: 10, implementationName: 'Nyaa', tags: [7], appProfileId: 1, added: '2026-03-01T00:00:00Z', categories: [] },
  { id: 3, name: 'Private One', enable: true, protocol: 'usenet', privacy: 'private', priority: 40, implementationName: 'Newznab', tags: [7], appProfileId: 2, added: '2025-06-01T00:00:00Z', categories: [] },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      mocks.sent.push({ method, path, body });
      const handler = mocks.respond[`${method} ${path}`];
      return handler ? handler(body) : json({ ok: true });
    }
    if (path === '/api/prowlarr/indexers') return json(INDEXERS);
    if (path === '/api/prowlarr/status') return json([{ indexerId: 3, escalationLevel: 2, mostRecentFailure: '2026-11-25T00:00:00Z' }]);
    if (path === '/api/prowlarr/tags') return json([{ id: 7, label: 'anime' }]);
    if (path === '/api/prowlarr/appprofile') return json([{ id: 1, name: 'Standard' }, { id: 2, name: 'Interactive' }]);
    if (path === '/api/prowlarr/health') return json(mocks.health);
    return json([]);
  }));
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ProwlarrPage /></QueryClientProvider>);
}

// Each row's name is a button; their order is the list's order.
const rowNames = () => screen.getAllByRole('button', { name: /^(YTS|Nyaa|Private One)$/ }).map((button) => button.textContent);
const filterMenu = () => within(screen.getByRole('menu', { name: 'Filter and sort' }));

beforeEach(() => {
  mocks.caps = new Set(['prowlarr.view', 'prowlarr.manage']);
  mocks.sent = [];
  mocks.respond = {};
  mocks.health = [];
  vi.clearAllMocks();
  localStorage.clear();
  useUIStore.setState({ prowlarrIndexerView: DEFAULT_PROWLARR_INDEXER_VIEW });
  stubFetch();
});

afterEach(() => vi.unstubAllGlobals());

describe('Indexers tab search, filters and sort', () => {
  it('lists by name, and narrows by search with a count of what is shown', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(rowNames()).toEqual(['Nyaa', 'Private One', 'YTS']));
    expect(screen.getByText('3 indexers')).toBeTruthy();

    await user.type(screen.getByRole('textbox', { name: 'Search indexers' }), 'ny');

    expect(rowNames()).toEqual(['Nyaa']);
    expect(screen.getByText('1 of 3 indexers')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Search: "ny" filter' })).toBeTruthy();
    expect(useUIStore.getState().prowlarrIndexerView.search).toBe('ny');
  });

  it('filters by status, failing, protocol, privacy, tag and app profile, each with a chip', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    await user.click(filterMenu().getByRole('menuitemcheckbox', { name: 'Enabled' }));
    expect(rowNames()).toEqual(['Private One', 'YTS']);

    await user.click(filterMenu().getByRole('menuitemcheckbox', { name: 'Failing or blocked' }));
    expect(rowNames()).toEqual(['Private One']);
    expect(screen.getByRole('button', { name: 'Remove Failing or blocked filter' })).toBeTruthy();

    // Clear all keeps the sort, drops every filter.
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(rowNames()).toHaveLength(3);

    await user.click(filterMenu().getByRole('menuitemcheckbox', { name: 'Usenet' }));
    expect(rowNames()).toEqual(['Private One']);
    await user.click(filterMenu().getByRole('menuitemcheckbox', { name: 'Usenet' }));

    await user.click(filterMenu().getByRole('menuitemcheckbox', { name: 'Public' }));
    expect(rowNames()).toEqual(['Nyaa', 'YTS']);
    await user.click(filterMenu().getByRole('menuitemcheckbox', { name: 'Public' }));

    await user.click(filterMenu().getByRole('menuitemcheckbox', { name: 'anime' }));
    expect(rowNames()).toEqual(['Nyaa', 'Private One']);
    expect(screen.getByRole('button', { name: 'Remove Tag: anime filter' })).toBeTruthy();

    await user.click(filterMenu().getByRole('menuitemcheckbox', { name: 'Interactive' }));
    expect(rowNames()).toEqual(['Private One']);
    expect(useUIStore.getState().prowlarrIndexerView).toMatchObject({ tags: [7], appProfiles: [2] });
  });

  it('sorts by priority (1 first) and by added (newest first), and a direction flips it', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    await user.click(filterMenu().getByRole('menuitemcheckbox', { name: 'Priority' }));
    expect(rowNames()).toEqual(['Nyaa', 'YTS', 'Private One']);

    await user.click(filterMenu().getByRole('menuitemcheckbox', { name: 'Added' }));
    expect(rowNames()).toEqual(['Nyaa', 'Private One', 'YTS']);

    await user.click(filterMenu().getByRole('button', { name: 'Ascending' }));
    expect(rowNames()).toEqual(['YTS', 'Private One', 'Nyaa']);
    expect(useUIStore.getState().prowlarrIndexerView).toMatchObject({ sort: 'added', sortDirection: 'asc' });
  });

  it('opens with the saved view', async () => {
    useUIStore.setState({ prowlarrIndexerView: { ...DEFAULT_PROWLARR_INDEXER_VIEW, state: 'disabled' } });
    renderPage();

    await waitFor(() => expect(rowNames()).toEqual(['Nyaa']));
    expect(screen.getByRole('button', { name: 'Remove Disabled filter' })).toBeTruthy();
  });

  it('drops a saved tag Prowlarr no longer has', async () => {
    useUIStore.setState({ prowlarrIndexerView: { ...DEFAULT_PROWLARR_INDEXER_VIEW, tags: [99] } });
    renderPage();

    await waitFor(() => expect(rowNames()).toHaveLength(3));
    expect(useUIStore.getState().prowlarrIndexerView.tags).toEqual([]);
  });
});

describe('Indexers tab Select mode', () => {
  it('is only for users who can manage', async () => {
    mocks.caps = new Set(['prowlarr.view']);
    renderPage();

    await waitFor(() => expect(rowNames()).toHaveLength(3));
    expect(screen.queryByRole('button', { name: 'Select', pressed: false })).toBeNull();
    expect(screen.queryByRole('menu', { name: 'Indexer actions' })).toBeNull();
  });

  it('enables the selected indexers in one request', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: 'Select', pressed: false }));
    await user.click(screen.getByRole('button', { name: 'Nyaa' }));
    await user.click(screen.getByRole('button', { name: 'YTS' }));
    expect(screen.getByLabelText('2 indexers selected')).toBeTruthy();
    // Rows' own controls step aside while selecting.
    expect(screen.queryByRole('switch', { name: 'Nyaa enabled' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Enable' }));

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Enabled 2 indexers'));
    expect(mocks.sent).toEqual([{ method: 'PUT', path: '/api/prowlarr/indexers/bulk', body: { ids: [2, 1], enable: true } }]);
  });

  it('acts only on selected rows still shown', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: 'Select', pressed: false }));
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByLabelText('3 indexers selected')).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Search indexers' }), 'yts');
    expect(screen.getByLabelText('1 indexer selected')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(mocks.sent).toHaveLength(1));
    expect(mocks.sent[0].body).toEqual({ ids: [1], enable: false });
  });

  it('adds a tag to each selected indexer', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    // Long-press's Select starts with that row picked.
    await user.click(within(screen.getByRole('group', { name: 'Actions for YTS' })).getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('button', { name: 'Tags' }));
    await user.click(await screen.findByRole('checkbox', { name: 'anime' }));
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(mocks.sent).toHaveLength(1));
    expect(mocks.sent[0]).toEqual({ method: 'PUT', path: '/api/prowlarr/indexers/bulk', body: { ids: [1], tags: [7], applyTags: 'add' } });
  });

  it('sets a priority on the selection', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: 'Select', pressed: false }));
    await user.click(screen.getByRole('button', { name: 'Nyaa' }));
    await user.click(screen.getByRole('button', { name: 'Priority' }));
    // Starts from the selection's own priority.
    await user.click(await screen.findByRole('button', { name: 'Raise the priority number' }));
    await user.click(screen.getByRole('button', { name: 'Set priority' }));

    await waitFor(() => expect(mocks.sent).toHaveLength(1));
    expect(mocks.sent[0].body).toEqual({ ids: [2], priority: 11 });
  });

  it('deletes after a confirm that names the count, and reports what did not go', async () => {
    mocks.respond['DELETE /api/prowlarr/indexers/bulk'] = () => json({ deleted: [2], failed: [3] });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: 'Select', pressed: false }));
    await user.click(screen.getByRole('button', { name: 'Nyaa' }));
    await user.click(screen.getByRole('button', { name: 'Private One' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete 2 indexers?')).toBeTruthy();
    expect(within(dialog).getByText(/Nyaa, Private One/)).toBeTruthy();
    expect(mocks.sent).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Delete 2 indexers' }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('1 deleted, 1 not deleted', { description: 'Private One' }));
    expect(mocks.sent).toEqual([{ method: 'DELETE', path: '/api/prowlarr/indexers/bulk', body: { ids: [2, 3] } }]);
  });
});

describe('Health banner Re-check', () => {
  it('runs CheckHealth, waits for it, and reads health again', async () => {
    mocks.health = [{ source: 'IndexerStatusCheck', type: 'warning', message: 'Indexers unavailable: YTS', wikiUrl: '' }];
    mocks.respond['POST /api/prowlarr/command'] = () => json({ id: 41, name: 'CheckHealth', status: 'queued' });
    mocks.pollCommand.mockImplementation(async () => {
      mocks.health = [];
      return 'completed';
    });
    const user = userEvent.setup();
    renderPage();

    const banner = await screen.findByRole('status', { name: 'Prowlarr health' });
    await user.click(within(banner).getByRole('button', { name: 'Re-check' }));

    await waitFor(() => expect(screen.queryByRole('status', { name: 'Prowlarr health' })).toBeNull());
    expect(mocks.sent).toEqual([{ method: 'POST', path: '/api/prowlarr/command', body: { name: 'CheckHealth' } }]);
    expect(mocks.pollCommand).toHaveBeenCalledWith('prowlarr', 41);
    expect(mocks.toast.success).toHaveBeenCalledWith('Health checked');
  });

  it('is not offered without prowlarr.manage', async () => {
    mocks.caps = new Set(['prowlarr.view']);
    mocks.health = [{ source: 'IndexerStatusCheck', type: 'warning', message: 'Indexers unavailable: YTS', wikiUrl: '' }];
    renderPage();

    const banner = await screen.findByRole('status', { name: 'Prowlarr health' });
    expect(within(banner).queryByRole('button', { name: 'Re-check' })).toBeNull();
  });
});
