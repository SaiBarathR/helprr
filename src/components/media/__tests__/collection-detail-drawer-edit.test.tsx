// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true, useMe: () => ({ role: 'admin' }) }));
vi.mock('@/components/media/fade-in-image', () => ({ FadeInImage: () => null }));
vi.mock('@/components/media/tag-selector', () => ({ TagSelector: () => null }));
vi.mock('@/components/ui/app-link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
// The drawer as plain markup, so the test drives its content.
vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DrawerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import { CollectionDetailDrawer } from '../collection-detail-drawer';
import type { CollectionSummary } from '@/types';

const COLLECTION = {
  id: 7, title: 'Pair', monitored: false, poster: null, genres: [], movieCount: 1, missingMovies: 0,
  movies: [{ tmdbId: 1, title: 'One', poster: null, inLibrary: true, monitored: false, movieId: 3, hasFile: true }],
  qualityProfileId: 1, rootFolderPath: '/movies', minimumAvailability: 'released', searchOnAdd: false, tags: [],
  instanceId: 'r1',
} as CollectionSummary;
let puts: Record<string, unknown>[];

beforeEach(() => {
  puts = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (init?.method === 'PUT') {
      puts.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const body = url.pathname === '/api/radarr/qualityprofiles' ? [{ id: 1, name: 'Any' }, { id: 4, name: 'HD' }]
      : url.pathname === '/api/radarr/rootfolders' ? [{ id: 1, path: '/movies' }]
        : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const profileSelect = () =>
  screen.getAllByRole('combobox').find((s) => Array.from((s as HTMLSelectElement).options, (o) => o.value).join() === '1,4') as HTMLSelectElement;

describe('collection drawer Edit', () => {
  it('returns to the collection after saving, and reopens Edit on the saved options before the list refetches', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><CollectionDetailDrawer collection={COLLECTION} onClose={vi.fn()} /></QueryClientProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(profileSelect().value).toBe('1'));
    fireEvent.change(profileSelect(), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Search on Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    expect(puts).toEqual([{ collectionId: 7, instanceId: 'r1', qualityProfileId: 4, searchOnAdd: true }]);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(profileSelect().value).toBe('4'));
    expect(screen.getByRole('switch', { name: 'Search on Add' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('goes back to the collection on Cancel without saving', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><CollectionDetailDrawer collection={COLLECTION} onClose={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(puts).toHaveLength(0);
  });
});
