// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('term=Show&tvdbId=1') }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
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

const routes: Record<string, unknown> = {
  '/api/instances': [{ id: 'son-2', type: 'SONARR', label: 'Sonarr 2', isDefault: true }],
  '/api/sonarr/qualityprofiles': [{ id: 4, name: 'HD' }],
  '/api/sonarr/rootfolders': [{ id: 1, path: '/tv' }],
  '/api/sonarr/lookup': [{ title: 'Show', tvdbId: 1, titleSlug: 'show', images: [], seasons: [], year: 2020 }],
};
let posts: Record<string, unknown>[];

beforeEach(() => {
  posts = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: 9 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(routes[url.pathname] ?? []), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
