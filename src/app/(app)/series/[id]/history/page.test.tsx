// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '7' }),
  useSearchParams: () => new URLSearchParams('instance=son-1'),
}));
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
}));
vi.mock('@/components/ui/quick-context-menu', () => ({
  QuickContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import SeriesHistoryPage from './page';

const SERIES = { id: 7, title: 'Severance' };
const EPISODES = [
  { id: 101, seriesId: 7, seasonNumber: 1, episodeNumber: 2 },
  { id: 205, seriesId: 7, seasonNumber: 2, episodeNumber: 10 },
];
const HISTORY = [
  { id: 3, episodeId: 205, seriesId: 7, eventType: 'downloadFolderImported', sourceTitle: 'Severance.S02E10.1080p', date: '2026-11-20T10:00:00Z', quality: { quality: { name: 'WEBDL-1080p' } }, data: {} },
  { id: 2, episodeId: 101, seriesId: 7, eventType: 'grabbed', sourceTitle: 'Severance.S01E02.720p', date: '2026-11-19T10:00:00Z', quality: { quality: { name: 'HDTV-720p' } }, data: { indexer: 'Example' } },
  { id: 1, episodeId: 999, seriesId: 7, eventType: 'episodeFileDeleted', sourceTitle: 'Gone.S03E01', date: '2026-11-18T10:00:00Z', quality: { quality: { name: 'SDTV' } }, data: {} },
];

let requested: string[];
let historyResponse: () => Response;

beforeEach(() => {
  requested = [];
  historyResponse = () => Response.json(HISTORY);
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    requested.push(input);
    if (input.startsWith('/api/sonarr/history/series')) return historyResponse();
    if (input.startsWith('/api/sonarr/7/episodes')) return Response.json(EPISODES);
    if (input.startsWith('/api/sonarr/7')) return Response.json(SERIES);
    return Response.json({});
  }));
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SeriesHistoryPage /></QueryClientProvider>);
  return userEvent.setup();
}

describe('series history page', () => {
  it("lists the series' history on the chosen instance, naming each record's episode", async () => {
    const user = renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Severance' })).toBeTruthy();
    const imported = (await screen.findByText('Severance.S02E10.1080p')).closest('button')!;
    expect(within(imported).getByText('IMPORTED')).toBeTruthy();
    await waitFor(() => expect(within(imported).getByText('S02E10')).toBeTruthy());
    const grabbed = screen.getByText('Severance.S01E02.720p').closest('button')!;
    expect(within(grabbed).getByText('S01E02')).toBeTruthy();
    // An episode Sonarr no longer lists still shows its record, without a label.
    const deleted = screen.getByText('Gone.S03E01').closest('button')!;
    expect(within(deleted).getByText('FILE DELETED')).toBeTruthy();
    expect(within(deleted).queryByText(/^S\d\dE\d\d$/)).toBeNull();
    expect(requested).toContain('/api/sonarr/history/series?seriesId=7&instanceId=son-1');

    await user.click(grabbed);
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Episode')).toBeTruthy();
    expect(within(drawer).getByText('S01E02')).toBeTruthy();
    expect(within(drawer).getByText('Example')).toBeTruthy();
  });

  it('says when the history cannot be loaded, rather than that there is none', async () => {
    historyResponse = () => Response.json({ error: 'Forbidden' }, { status: 403 });
    renderPage();
    expect(await screen.findByText('Could not load the history')).toBeTruthy();
    expect(screen.queryByText('No history available')).toBeNull();
  });
});
