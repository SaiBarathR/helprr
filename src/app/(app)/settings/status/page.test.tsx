// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Service status shows each Sonarr/Radarr/Lidarr instance's health to those
// who may read it, and a health push's link opens that instance's sheet.

const mocks = vi.hoisted(() => ({
  me: null as unknown,
  search: new URLSearchParams(),
  healthCalls: [] as string[],
  statuses: [] as unknown[],
}));
vi.mock('@/components/permission-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/permission-provider')>()),
  useMe: () => mocks.me,
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.search }));
vi.mock('@/lib/hooks/use-app-settings', () => ({ useAppSettings: () => ({ settings: null, update: vi.fn() }) }));
vi.mock('@/components/settings/polling-health-section', () => ({ PollingHealthSection: () => null }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import ServiceStatusPage from './page';

const ADMIN = { id: 'a', role: 'admin', capabilities: {} };
const MEMBER = { id: 'm', role: 'member', capabilities: { 'series.view': true, 'movies.view': true } };

const statuses = [
  { instanceId: 'son-1', type: 'SONARR', name: 'Sonarr', label: 'Sonarr', ok: true },
  { instanceId: 'son-2', type: 'SONARR', name: 'Sonarr', label: 'Anime', ok: true },
  { instanceId: 'rad-1', type: 'RADARR', name: 'Radarr', label: 'Radarr', ok: false, error: 'Connection refused' },
];
const health: Record<string, unknown[]> = {
  'son-1': [],
  'son-2': [
    { source: 'IndexerStatusCheck', type: 'warning', message: 'Indexers unavailable: Nyaa', wikiUrl: 'https://wiki.servarr.com/sonarr/system#indexers' },
    { source: 'RootFolderCheck', type: 'error', message: 'Missing root folder: /anime', wikiUrl: '' },
  ],
};

beforeEach(() => {
  mocks.me = ADMIN;
  mocks.search = new URLSearchParams();
  mocks.healthCalls = [];
  mocks.statuses = statuses;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/services/health') return new Response(JSON.stringify(mocks.statuses));
    const match = url.match(/^\/api\/(sonarr|radarr|lidarr)\/health\?instanceId=(.+)$/);
    if (match) {
      mocks.healthCalls.push(match[2]);
      // As the real routes do, another service's instance id is not found.
      if (!match[2].startsWith(match[1].slice(0, 3))) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(health[match[2]] ?? []));
    }
    return new Response('{}');
  }));
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ServiceStatusPage />
    </QueryClientProvider>,
  );
}

describe('Service status health', () => {
  it('sums up each reachable instance, and opens its checks, errors first', async () => {
    renderPage();
    expect(await screen.findByText('2 health issues')).toBeTruthy();
    expect(screen.getByText('No health issues')).toBeTruthy();
    // An unreachable instance's health is not asked for.
    expect(mocks.healthCalls.sort()).toEqual(['son-1', 'son-2']);

    await userEvent.click(screen.getByRole('button', { name: /Anime.*2 health issues/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Sonarr · Anime health')).toBeTruthy();
    const messages = within(sheet).getAllByText(/Missing root folder|Indexers unavailable/).map((el) => el.textContent);
    expect(messages).toEqual(['Missing root folder: /anime', 'Indexers unavailable: Nyaa']);
    expect(within(sheet).getByText('· Root Folder')).toBeTruthy();
    expect(within(sheet).getByRole('link', { name: /Learn more/ }).getAttribute('href')).toBe('https://wiki.servarr.com/sonarr/system#indexers');
  });

  it("opens the instance a health push's link names, then drops the link from the URL", async () => {
    window.history.replaceState({ kept: true }, '', '/settings/status?health=sonarr&instance=son-2');
    const replace = vi.spyOn(window.history, 'replaceState');
    mocks.search = new URLSearchParams('health=sonarr&instance=son-2');
    renderPage();
    const sheet = await screen.findByRole('dialog');
    await waitFor(() => expect(within(sheet).getByText('Missing root folder: /anime')).toBeTruthy());
    expect(within(sheet).getByText('Sonarr · Anime health')).toBeTruthy();
    // Back to this page, or a reload, doesn't open it again; the page's history state stays.
    expect(replace).toHaveBeenCalledWith({ kept: true }, '', '/settings/status');
    replace.mockRestore();
  });

  it("opens the instance's own health when a link names the wrong service", async () => {
    mocks.search = new URLSearchParams('health=radarr&instance=son-2');
    renderPage();
    const sheet = await screen.findByRole('dialog');
    await waitFor(() => expect(within(sheet).getByText('Missing root folder: /anime')).toBeTruthy());
    expect(within(sheet).getByText('Sonarr · Anime health')).toBeTruthy();
    expect(within(sheet).queryByText(/Radarr/)).toBeNull();
  });

  it('opens nothing when a link names an instance that has no health', async () => {
    mocks.statuses = [...statuses, { instanceId: 'qbt-1', type: 'QBITTORRENT', name: 'qBittorrent', label: 'qBittorrent', ok: true }];
    mocks.search = new URLSearchParams('health=sonarr&instance=qbt-1');
    renderPage();
    expect(await screen.findByText('2 health issues')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText(/qBittorrent health/)).toBeNull();
  });

  it('shows no health to a member without notify.health, and ignores the link', async () => {
    mocks.me = MEMBER;
    mocks.search = new URLSearchParams('health=sonarr&instance=son-2');
    renderPage();
    expect(await screen.findAllByText('Online')).toHaveLength(2);
    expect(screen.queryByText(/health issue/)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /Anime/ })).toBeNull();
    expect(mocks.healthCalls).toEqual([]);
  });

  it('shows health to a member granted notify.health', async () => {
    mocks.me = { ...MEMBER, capabilities: { ...MEMBER.capabilities, 'notify.health': true } };
    renderPage();
    expect(await screen.findByText('2 health issues')).toBeTruthy();
  });
});
