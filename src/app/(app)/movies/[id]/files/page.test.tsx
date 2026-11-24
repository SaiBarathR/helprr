// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '5' }),
  useSearchParams: () => new URLSearchParams('instance=rad-1'),
}));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => false }));
vi.mock('@/components/layout/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
  DrawerContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DrawerHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DrawerTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DrawerDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DrawerClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DrawerFooter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/quick-context-menu', () => ({
  QuickContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import MovieFilesPage from './page';

// Radarr's movie resource carries no custom formats or score on its embedded file.
const MOVIE = {
  id: 5, title: 'Alien', hasFile: true,
  movieFile: { id: 31, relativePath: 'Alien (1979).mkv', path: '/movies/Alien (1979).mkv', size: 2048, quality: { quality: { name: 'Bluray-1080p' } } },
};
const FILES = [{ id: 31, movieId: 5, customFormats: [{ id: 2, name: 'HDR10' }, { id: 7, name: 'Remux Tier 01' }], customFormatScore: 1750 }];
const HISTORY = [{ id: 1, eventType: 'grabbed', sourceTitle: 'Alien.1979.1080p.BluRay', date: '2026-11-20T10:00:00Z', quality: { quality: { name: 'Bluray-1080p' } }, data: {} }];

let requested: string[];
beforeEach(() => {
  requested = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    requested.push(input);
    if (input.startsWith('/api/radarr/moviefile')) return Response.json(FILES);
    if (input.startsWith('/api/radarr/history/movie')) return Response.json(HISTORY);
    if (input.startsWith('/api/radarr/5')) return Response.json(MOVIE);
    return Response.json({});
  }));
});

describe('movie files page', () => {
  it("shows the file's custom formats and real score from the moviefile resource, and its history", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MovieFilesPage /></QueryClientProvider>);
    const card = (await screen.findByText('Alien (1979).mkv')).closest('button')!;
    expect(await within(card).findByText('CF +1750')).toBeTruthy();
    expect(within(card).getByText('HDR10')).toBeTruthy();
    expect(within(card).getByText('Remux Tier 01')).toBeTruthy();
    expect(requested).toContain('/api/radarr/moviefile?movieId=5&instanceId=rad-1');
    expect(screen.getByText('Alien.1979.1080p.BluRay')).toBeTruthy();

    await userEvent.setup().click(card);
    const drawer = screen.getByRole('dialog');
    const row = (label: string) => within(drawer).getByText(label).parentElement!.textContent;
    expect(row('Score')).toBe('Score+1750');
    expect(row('Custom Formats')).toBe('Custom FormatsHDR10, Remux Tier 01');
  });
});
