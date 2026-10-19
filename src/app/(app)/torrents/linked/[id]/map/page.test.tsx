// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  download: {} as Record<string, unknown>,
  posts: [] as Array<{ url: string; body: unknown }>,
  preview: [] as Array<{ fileId: string; rejections: string[] }>,
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'md1' }) }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn(), replace: mocks.replace }) }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import MapFilesPage from './page';

const series = { id: 3, title: 'Classroom of the Elite' };
const arrRead = (extra: Record<string, unknown> = {}) => ({ movie: null, series, episodes: [], quality: 'WEBDL-1080p', languages: ['Japanese'], releaseGroup: 'GRP', rejections: [], ...extra });
const file = (id: string, path: string, arr: unknown, extra: Record<string, unknown> = {}) => ({
  id, fileIndex: 0, path, size: 1000, selected: true, decision: 'PENDING', episodeIds: [], scanned: true, arr, ...extra,
});
const sonarrDownload = () => ({
  id: 'md1', mode: 'QBIT_REVIEWED', status: 'NEEDS_MAPPING', service: 'SONARR', instanceId: 's1', instanceLabel: 'sonarr-anime',
  arrItemId: 3, arrItemTitle: 'Classroom of the Elite',
  files: [
    file('f0', 'Show.S01/Show.S01E05.mkv', arrRead({ episodes: [{ id: 26, seasonNumber: 1, episodeNumber: 5 }] })),
    file('f1', 'Show.S01/random-name.mkv', arrRead({ episodes: [{ id: 22, seasonNumber: 1, episodeNumber: 1 }, { id: 23, seasonNumber: 1, episodeNumber: 2 }], rejections: ['Single episode file contains all episodes in seasons', 'Sample'] })),
    file('f2', 'Show.S01/notes.nfo', null),
    file('f3', 'Show.S01/other.mkv', null, { selected: false, scanned: false }),
  ],
});

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.posts = [];
  mocks.preview = [];
  mocks.download = sonarrDownload();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      mocks.posts.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(url.includes('preview') ? { files: mocks.preview } : { download: mocks.download }));
    }
    if (url.includes('/episodes')) {
      return new Response(JSON.stringify([1, 2, 5, 6].map((n) => ({ id: 21 + n, seasonNumber: 1, episodeNumber: n, title: `Episode ${n}`, hasFile: n === 1 }))));
    }
    return new Response(JSON.stringify({ download: mocks.download }));
  }));
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MapFilesPage /></QueryClientProvider>);
}

describe('mapping the files of a fallback download', () => {
  it("starts from Sonarr's reading: the clean file in, the doubtful one out, extras listed", async () => {
    renderPage();
    const known = (await screen.findByText('Show.S01E05.mkv')).closest('section')!;
    expect(within(known).getByRole('button', { name: 'Import' }).getAttribute('aria-pressed')).toBe('true');
    expect(await within(known).findByRole('button', { name: /S01E05/ })).toBeTruthy();
    const doubtful = screen.getByText('random-name.mkv').closest('section')!;
    expect(within(doubtful).getByRole('button', { name: 'Leave it' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(doubtful).getByText('Single episode file contains all episodes in seasons')).toBeTruthy();
    expect(screen.getByText(/Also chosen, not videos: notes.nfo/)).toBeTruthy();
    expect(screen.queryByText('other.mkv')).toBeNull();
  });

  it('needs episodes for each imported file, checks with Sonarr, and asks before importing past an objection', async () => {
    renderPage();
    const user = userEvent.setup();
    const doubtful = (await screen.findByText('random-name.mkv')).closest('section')!;
    await user.click(within(doubtful).getByRole('button', { name: 'Import' }));
    // Sonarr read it as all of season 1; the user picks the one episode it holds.
    await user.click(within(doubtful).getByRole('button', { name: /S01E01, S01E02/ }));
    await user.click(within(doubtful).getByRole('checkbox', { name: /S01E01/ }));
    await user.click(within(doubtful).getByRole('checkbox', { name: /S01E02/ }));
    expect(screen.getByRole('button', { name: /Import 2 files/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Choose the episodes for each file you import.')).toBeTruthy();
    await user.click(within(doubtful).getByRole('checkbox', { name: /S01E06/ }));

    mocks.preview = [{ fileId: 'f0', rejections: [] }, { fileId: 'f1', rejections: ['Single episode file contains all episodes in seasons'] }];
    await user.click(screen.getByRole('button', { name: 'Check with Sonarr' }));
    await waitFor(() => expect(mocks.posts).toHaveLength(1));
    expect(mocks.posts[0]).toEqual({
      url: '/api/manual-downloads/md1/import?preview=1',
      body: { files: [{ fileId: 'f0', decision: 'IMPORT', episodeIds: [26] }, { fileId: 'f1', decision: 'IMPORT', episodeIds: [27] }] },
    });

    await user.click(screen.getByRole('button', { name: /Import 2 files/ }));
    const confirm = screen.getByRole('alertdialog');
    expect(within(confirm).getByText(/random-name.mkv: Single episode file contains all episodes in seasons/)).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'Import anyway' }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/torrents/linked/md1'));
    expect(mocks.posts[1].url).toBe('/api/manual-downloads/md1/import');
  });

  it('imports one file for a movie: choosing another leaves the first', async () => {
    mocks.download = {
      ...sonarrDownload(), service: 'RADARR', arrItemId: 15, arrItemTitle: 'Night of the Living Dead',
      files: [
        file('m0', 'Film/Film.1080p.mkv', arrRead({ series: null, movie: { id: 15, title: 'Night of the Living Dead' } })),
        file('m1', 'Film/Film.720p.mkv', arrRead({ series: null, movie: { id: 15, title: 'Night of the Living Dead' } })),
      ],
    };
    renderPage();
    const user = userEvent.setup();
    const first = (await screen.findByText('Film.1080p.mkv')).closest('section')!;
    const second = screen.getByText('Film.720p.mkv').closest('section')!;
    expect(within(first).getByRole('button', { name: 'Import' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(second).getByRole('button', { name: 'Import' }).getAttribute('aria-pressed')).toBe('false');
    await user.click(within(second).getByRole('button', { name: 'Import' }));
    expect(within(first).getByRole('button', { name: 'Import' }).getAttribute('aria-pressed')).toBe('false');
    await user.click(screen.getByRole('button', { name: /Import 1 file/ }));
    await waitFor(() => expect(mocks.posts[0].body).toEqual({ files: [{ fileId: 'm0', decision: 'IGNORE', episodeIds: [] }, { fileId: 'm1', decision: 'IMPORT', episodeIds: [] }] }));
  });
});
