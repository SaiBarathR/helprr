// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('term=Show&tvdbId=1') }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/layout/page-header', () => ({
  PageHeader: ({ title, rightContent }: { title: string; rightContent?: React.ReactNode }) => <><h1>{title}</h1>{rightContent}</>,
}));
vi.mock('@/components/media/search-input', () => ({ SearchInput: () => null }));
vi.mock('@/components/media/tag-selector', () => ({ TagSelector: () => null }));
vi.mock('@/components/media/fade-in-image', () => ({ FadeInImage: () => null }));
// Each Select as a native <select>, so a test can pick an option.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import AddSeriesPage from './page';

let routes: Record<string, unknown>;
const baseRoutes: Record<string, unknown> = {
  '/api/instances': [{ id: 'son-2', type: 'SONARR', label: 'Sonarr 2', isDefault: true }],
  '/api/sonarr/qualityprofiles': [{ id: 4, name: 'HD' }, { id: 7, name: '4k Max OTT Quality' }],
  '/api/sonarr/rootfolders': [{ id: 1, path: '/tv' }, { id: 2, path: '/tv-kids' }],
  '/api/sonarr/lookup': [{ title: 'Show', tvdbId: 1, titleSlug: 'show', images: [], seasons: [], year: 2020 }],
};
// Per-instance overrides, keyed `${instanceId} ${pathname}`.
let instanceRoutes: Record<string, unknown>;
let posts: Record<string, unknown>[];

beforeEach(() => {
  posts = [];
  routes = { ...baseRoutes };
  instanceRoutes = {};
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: 9 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const body = instanceRoutes[`${url.searchParams.get('instanceId')} ${url.pathname}`] ?? routes[url.pathname] ?? [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><AddSeriesPage /></QueryClientProvider>);
}

const monitorNewSeasonsSelect = () =>
  screen.getAllByRole('combobox').find((select) =>
    Array.from((select as HTMLSelectElement).options, (o) => o.value).join() === 'all,none') as HTMLSelectElement;

describe('add series page', () => {
  it("sends Sonarr's Monitor New Seasons choice, defaulting to all", async () => {
    renderPage();
    await screen.findByText('Monitor New Seasons');
    await waitFor(() => expect(screen.getByDisplayValue('HD')).toBeTruthy());
    expect(monitorNewSeasonsSelect().value).toBe('all');

    fireEvent.click(screen.getByRole('button', { name: 'Add Series' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual(expect.objectContaining({ instanceId: 'son-2', tvdbId: 1, monitorNewItems: 'all' }));
  });

  it('sends none when the user turns new-season monitoring off', async () => {
    renderPage();
    await screen.findByText('Monitor New Seasons');
    await waitFor(() => expect(screen.getByDisplayValue('HD')).toBeTruthy());
    fireEvent.change(monitorNewSeasonsSelect(), { target: { value: 'none' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add Series' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual(expect.objectContaining({ monitorNewItems: 'none' }));
  });
});

describe('add series page remembered options', () => {
  const remember = (instanceId: string, value: Record<string, string>) =>
    localStorage.setItem(`helprr-add-defaults:sonarr:${instanceId}`, JSON.stringify(value));
  const addAndRead = async () => {
    renderPage();
    await screen.findByText('Monitor New Seasons');
    await waitFor(() => expect(screen.getByDisplayValue('/tv-kids')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Add Series' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    return posts[0];
  };

  it('opens on the profile, folder and monitor option last used on this instance, and saves the new choice', async () => {
    remember('son-2', { profileId: '7', rootFolder: '/tv-kids', monitor: 'future' });
    const post = await addAndRead();
    expect(post).toEqual(expect.objectContaining({
      instanceId: 'son-2',
      qualityProfileId: 7,
      rootFolderPath: '/tv-kids',
      addOptions: expect.objectContaining({ monitor: 'future' }),
    }));
    expect(JSON.parse(localStorage.getItem('helprr-add-defaults:sonarr:son-2')!)).toEqual({
      profileId: '7',
      rootFolder: '/tv-kids',
      monitor: 'future',
    });
  });

  it('ignores a choice remembered for another instance', async () => {
    remember('son-1', { profileId: '7', rootFolder: '/tv-kids', monitor: 'future' });
    renderPage();
    await screen.findByText('Monitor New Seasons');
    await waitFor(() => expect(screen.getByDisplayValue('HD')).toBeTruthy());
    expect(screen.getByDisplayValue('/tv')).toBeTruthy();
    expect(screen.getByDisplayValue('All Episodes')).toBeTruthy();
  });

  it('falls back to the first option when the remembered profile or folder no longer exists', async () => {
    remember('son-2', { profileId: '99', rootFolder: '/gone', monitor: 'bogus' });
    renderPage();
    await screen.findByText('Monitor New Seasons');
    await waitFor(() => expect(screen.getByDisplayValue('HD')).toBeTruthy());
    expect(screen.getByDisplayValue('/tv')).toBeTruthy();
    expect(screen.getByDisplayValue('All Episodes')).toBeTruthy();
  });
});

it("switching instances applies the new instance's remembered options, never the old one's", async () => {
  routes['/api/instances'] = [
    { id: 'son-1', type: 'SONARR', label: 'Sonarr 1', isDefault: false },
    { id: 'son-2', type: 'SONARR', label: 'Sonarr 2', isDefault: true },
  ];
  instanceRoutes['son-1 /api/sonarr/qualityprofiles'] = [{ id: 1, name: 'Anime' }, { id: 2, name: 'Anime 4K' }];
  instanceRoutes['son-1 /api/sonarr/rootfolders'] = [{ id: 1, path: '/anime' }];
  localStorage.setItem('helprr-add-defaults:sonarr:son-2', JSON.stringify({ profileId: '7', rootFolder: '/tv-kids', monitor: 'future' }));
  localStorage.setItem('helprr-add-defaults:sonarr:son-1', JSON.stringify({ profileId: '2', monitor: 'pilot' }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AddSeriesPage /></QueryClientProvider>);
  await screen.findByText('Monitor New Seasons');
  await waitFor(() => expect(screen.getByDisplayValue('4k Max OTT Quality')).toBeTruthy());
  expect(screen.getByDisplayValue('Future Episodes')).toBeTruthy();

  fireEvent.change(screen.getByDisplayValue('Sonarr 2'), { target: { value: 'son-1' } });
  await waitFor(() => expect(screen.getByDisplayValue('Anime 4K')).toBeTruthy());
  expect(screen.getByDisplayValue('/anime')).toBeTruthy();
  expect(screen.getByDisplayValue('Pilot Episode')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Add Series' }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toEqual(expect.objectContaining({ instanceId: 'son-1', qualityProfileId: 2, rootFolderPath: '/anime' }));
});
