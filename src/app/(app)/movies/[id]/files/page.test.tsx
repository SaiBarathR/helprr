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
const caps = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => caps.granted.has(cap) }));
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
// Captured from a real Radarr 7 (13 Assassins); the route has already dropped the rest.
const EXTRAS = [
  { id: 2982, movieFileId: 31, relativePath: 'Alien (1979)-poster.jpg', extension: '.jpg', type: 'metadata' },
  { id: 122, movieFileId: 31, relativePath: 'Alien (1979).eng.srt', extension: '.srt', type: 'subtitle', languageTags: ['forced'] },
  { id: 2983, movieFileId: 31, relativePath: 'Alien (1979)-fanart.jpg', extension: '.jpg', type: 'metadata' },
];
const BLOCKLIST = {
  records: [{ id: 9, sourceTitle: 'Alien.1979.CAM', date: '2026-11-21T10:00:00Z', source: 'radarr', instanceId: 'rad-1', instanceLabel: 'Main' }],
  truncated: false,
};
const HISTORY = [{ id: 1, eventType: 'grabbed', sourceTitle: 'Alien.1979.1080p.BluRay', date: '2026-11-20T10:00:00Z', quality: { quality: { name: 'Bluray-1080p' } }, data: {} }];

let requested: string[];
let movie: Record<string, unknown>;
beforeEach(() => {
  caps.granted = new Set();
  movie = MOVIE;
  requested = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    requested.push(input);
    if (input.startsWith('/api/radarr/moviefile')) return Response.json(FILES);
    if (input.startsWith('/api/radarr/history/movie')) return Response.json(HISTORY);
    if (input.startsWith('/api/radarr/extrafile')) return Response.json(EXTRAS);
    if (input.startsWith('/api/activity/blocklist/title')) return Response.json(BLOCKLIST);
    if (input.startsWith('/api/radarr/5')) return Response.json(movie);
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

  it('lists the extra files and the alternative titles in closed rows', async () => {
    movie = { ...MOVIE, alternateTitles: [{ title: 'Alien - Le huitième passager', sourceType: 'tmdb' }, { title: 'エイリアン' }] };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MovieFilesPage /></QueryClientProvider>);
    const user = userEvent.setup();

    const extras = await screen.findByRole('button', { name: /Extra files/ });
    expect(extras.textContent).toContain('1 subtitle, 2 metadata');
    expect(extras.getAttribute('aria-expanded')).toBe('false');
    expect(requested).toContain('/api/radarr/extrafile?movieId=5&instanceId=rad-1');
    expect(screen.queryByText('Alien (1979).eng.srt')).toBeNull();
    await user.click(extras);
    const items = within(extras.parentElement!).getAllByRole('listitem').map((li) => li.textContent);
    // Subtitles first: whether one exists is what the row answers.
    expect(items).toEqual([
      'Alien (1979).eng.srtSubtitle · forced',
      'Alien (1979)-fanart.jpgMetadata',
      'Alien (1979)-poster.jpgMetadata',
    ]);

    const titles = screen.getByRole('button', { name: /Alternative titles/ });
    expect(titles.textContent).toContain('2');
    await user.click(titles);
    expect(screen.getByText('Alien - Le huitième passager')).toBeTruthy();
    expect(screen.getByText('エイリアン')).toBeTruthy();
  });

  it("shows the movie's blocklist only to a viewer of Activity, read on the page's instance", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(<QueryClientProvider client={client}><MovieFilesPage /></QueryClientProvider>);
    await screen.findByText('Alien.1979.1080p.BluRay');
    expect(screen.queryByText('Blocklist')).toBeNull();
    expect(requested.some((url) => url.startsWith('/api/activity/blocklist/title'))).toBe(false);
    unmount();

    caps.granted = new Set(['activity.view']);
    render(<QueryClientProvider client={new QueryClient()}><MovieFilesPage /></QueryClientProvider>);
    expect(await screen.findByText('Alien.1979.CAM')).toBeTruthy();
    expect(screen.getByText('Blocklist')).toBeTruthy();
    expect(requested).toContain('/api/activity/blocklist/title?source=radarr&movieId=5&instanceId=rad-1');
    // Remove needs activity.manage, as on Activity → Blocklist.
    await userEvent.setup().click(screen.getByText('Alien.1979.CAM'));
    expect(screen.queryByRole('button', { name: /Remove from blocklist/ })).toBeNull();
  });
});
