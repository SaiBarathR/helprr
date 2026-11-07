// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ search: new URLSearchParams(), back: vi.fn(), track: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.search, usePathname: () => '/activity/import' }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn(), back: mocks.back }) }));
vi.mock('@/lib/manual-import-tracker', () => ({ trackManualImport: mocks.track }));
import ManualImportPage from '../page';

const FLAC = { quality: { id: 6, name: 'FLAC' } };
const artist = { id: 8, artistName: 'The Band' };
const album = { id: 3, title: 'First Album', artistId: 8, releaseDate: '2024-05-01', albumType: 'Album', releases: [{ id: 73, monitored: true }] };
const track = (id: number, n: number, mediumNumber = 1) => ({ id, trackNumber: String(n), absoluteTrackNumber: n, mediumNumber, title: `Song ${n}` });
// What Lidarr's manual import returns for files it matched to an album.
const matched = [1, 2].map((n) => ({
  id: n, path: `/downloads/album/0${n}.flac`, name: `0${n}.flac`, relativePath: `0${n}.flac`, quality: FLAC,
  artist, album, albumReleaseId: 73, tracks: [track(730 + n, n)], releaseGroup: 'grp', indexerFlags: 0,
  disableReleaseSwitching: false, rejections: [],
}));
// And for files whose tags matched no album.
const unmatched = [1, 2].map((n) => ({
  id: n, path: `/downloads/album/0${n}.flac`, name: `0${n}.flac`, relativePath: `0${n}.flac`, quality: FLAC,
  tracks: [], albumReleaseId: 0, rejections: [{ type: 'permanent', reason: 'Couldn\'t find similar album' }],
}));

let files: unknown[];
let requests: string[];
let submitted: Record<string, unknown> | null;
let reprocessed: { source: string; instanceId?: string; items: Array<Record<string, unknown>> } | null;

beforeEach(() => {
  files = matched;
  requests = [];
  submitted = null;
  reprocessed = null;
  mocks.back.mockClear(); mocks.track.mockClear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    requests.push(url);
    if (init?.method === 'POST' && url === '/api/activity/manualimport/reprocess') {
      reprocessed = JSON.parse(String(init.body));
      // Lidarr re-matches the tracks on the chosen album, on its release 73.
      return Response.json(reprocessed!.items.map((item, i) => ({
        id: item.id, path: item.path, artist, album, albumReleaseId: 73, tracks: [track(731 + i, i + 1)], quality: FLAC, rejections: [],
      })));
    }
    if (init?.method === 'POST') { submitted = JSON.parse(String(init.body)); return Response.json({ id: 9 }); }
    if (url.startsWith('/api/activity/manualimport')) return Response.json([...files].reverse());
    if (url.startsWith('/api/lidarr/8/albums')) return Response.json([{ ...album, id: 4, title: 'Second Album', releaseDate: '2026-01-01' }, album]);
    if (url.startsWith('/api/lidarr/album/3/tracks')) return Response.json([track(731, 1), track(732, 2), track(733, 3)]);
    if (url.startsWith('/api/lidarr')) return Response.json([{ id: 9, artistName: 'Another Act' }, artist]);
    return Response.json({});
  }));
});

function renderPage(query: string) {
  mocks.search = new URLSearchParams(query);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><ManualImportPage /></QueryClientProvider>);
}
const importButton = (count: number) => screen.findByRole('button', { name: `Import ${count} ${count === 1 ? 'File' : 'Files'}` });

describe('Lidarr manual import', () => {
  it('imports the files Lidarr matched, with their album, release and tracks', async () => {
    const user = userEvent.setup();
    renderPage('downloadId=D&source=lidarr&instanceId=lid-1&title=The Band - First Album');
    await user.click(await importButton(2));

    expect(requests[0]).toBe('/api/activity/manualimport?downloadId=D&source=lidarr&instanceId=lid-1');
    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted).toEqual({
      source: 'lidarr', instanceId: 'lid-1', title: 'The Band - First Album',
      files: [1, 2].map((n) => ({
        path: `/downloads/album/0${n}.flac`, artistId: 8, albumId: 3, albumReleaseId: 73, trackIds: [730 + n],
        quality: FLAC, releaseGroup: 'grp', indexerFlags: 0, disableReleaseSwitching: false, downloadId: 'D',
      })),
    });
    expect(mocks.track).toHaveBeenCalledWith(expect.anything(), {
      service: 'lidarr', instanceId: 'lid-1', downloadId: 'D', commandId: 9, title: 'The Band - First Album',
    });
    expect(mocks.back).toHaveBeenCalled();
  });

  it('lets the user choose the artist and album when Lidarr matched none', async () => {
    const user = userEvent.setup();
    files = unmatched;
    renderPage('downloadId=D&source=lidarr&instanceId=lid-1&title=Pack');
    expect(await screen.findByText('Lidarr could not match these files to an album.')).toBeDefined();
    expect((await importButton(2)).hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Choose album' }));
    await user.click(await screen.findByRole('button', { name: 'The Band' }));
    expect(requests).toContain('/api/lidarr?instanceId=lid-1');
    // Newest first, as Lidarr lists an artist's albums.
    const albums = await screen.findAllByRole('button', { name: /Album/ });
    expect(albums.map((b) => b.textContent)).toEqual(['Second Album2026 · Album', 'First Album2024 · Album']);
    await user.click(albums[1]);

    // Lidarr is asked to match exactly these files on that album, and picks the release and tracks.
    await waitFor(() => expect(reprocessed).not.toBeNull());
    expect(reprocessed).toMatchObject({ source: 'lidarr', instanceId: 'lid-1' });
    expect(reprocessed!.items).toEqual([1, 2].map((n) => expect.objectContaining({
      id: n, path: `/downloads/album/0${n}.flac`, downloadId: 'D', artistId: 8, albumId: 3, trackIds: [],
    })));
    await waitFor(() => expect(document.body.textContent).toContain('Album: First Album · The Band'));
    expect(screen.queryByText("Couldn't find similar album")).toBeNull();

    await user.click(await importButton(2));
    await waitFor(() => expect(submitted).not.toBeNull());
    expect((submitted!.files as unknown[])).toEqual([1, 2].map((n) => expect.objectContaining({
      path: `/downloads/album/0${n}.flac`, artistId: 8, albumId: 3, albumReleaseId: 73, trackIds: [730 + n],
    })));
  });

  it('keeps the choice when Lidarr cannot check it, and waits for a track', async () => {
    const user = userEvent.setup();
    files = unmatched;
    vi.mocked(fetch).mockImplementation(((base) => async (url: string, init?: RequestInit) => (
      url === '/api/activity/manualimport/reprocess' ? Response.json({ error: 'upstream' }, { status: 502 }) : base(url, init)
    ))(vi.mocked(fetch).getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>) as typeof fetch);
    renderPage('downloadId=D&source=lidarr&instanceId=lid-1&title=Pack');
    await user.click(await screen.findByRole('button', { name: 'Choose album' }));
    await user.click(await screen.findByRole('button', { name: 'The Band' }));
    await user.click(await screen.findByRole('button', { name: /^First Album/ }));

    await waitFor(() => expect(screen.getAllByRole('status')).toHaveLength(2));
    expect(screen.getAllByRole('status')[0].textContent).toBe(
      "Lidarr couldn't check this file against First Album; it will be imported as it is. Choose a track before importing.",
    );
    expect((await importButton(2)).hasAttribute('disabled')).toBe(true);
    // The album's selected release stands in for Lidarr's answer, so its tracks can be picked.
    const pickers = screen.getAllByRole('button', { name: /No track assigned/ });
    await user.click(pickers[0]);
    await user.click(await screen.findByRole('button', { name: '1. Song 1' }));
    expect(requests).toContain('/api/lidarr/album/3/tracks?albumReleaseId=73&instanceId=lid-1');
  });

  it('matches a leftover file on the release Lidarr placed the rest of its album on', async () => {
    const user = userEvent.setup();
    files = [matched[0], { ...unmatched[1] }];
    renderPage('downloadId=D&source=lidarr&title=Pack');
    expect(await screen.findByText('Lidarr could not match this file to an album.')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Choose album' }));
    await user.click(await screen.findByRole('button', { name: 'The Band' }));
    await user.click(await screen.findByRole('button', { name: /^First Album/ }));
    await waitFor(() => expect(reprocessed).not.toBeNull());
    // Only the unplaced file is re-matched, on release 73.
    expect(reprocessed!.items).toEqual([expect.objectContaining({ path: '/downloads/album/02.flac', albumId: 3, albumReleaseId: 73 })]);
  });

  it('will not import two ticked files on the same track', async () => {
    const user = userEvent.setup();
    files = [matched[0], { ...matched[1], tracks: matched[0].tracks }];
    renderPage('downloadId=D&source=lidarr&title=Pack');
    expect((await importButton(2)).hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByText('Another ticked file has this track. Change one of them.')).toHaveLength(2);

    await user.click(screen.getByRole('checkbox', { name: 'Import 02.flac' }));
    expect((await importButton(1)).hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText('Another ticked file has this track. Change one of them.')).toBeNull();
  });

  it('changes one file\'s track from the tracks of its release', async () => {
    const user = userEvent.setup();
    renderPage('downloadId=D&source=lidarr&instanceId=lid-1&title=Pack');
    await importButton(2);
    const changes = screen.getAllByRole('button', { name: /Change$/ }).filter((b) => b.textContent?.startsWith('1. Song 1'));
    await user.click(changes[0]);
    expect(await screen.findByText('Select Track')).toBeDefined();
    await user.click(await screen.findByRole('button', { name: '3. Song 3' }));
    expect(requests).toContain('/api/lidarr/album/3/tracks?albumReleaseId=73&instanceId=lid-1');

    await user.click(await importButton(2));
    await waitFor(() => expect(submitted).not.toBeNull());
    expect((submitted!.files as Array<{ trackIds: number[] }>).map((f) => f.trackIds)).toEqual([[733], [732]]);
  });

  it('requires a track for every ticked file, and leaves unticked ones out', async () => {
    const user = userEvent.setup();
    files = [matched[0], { ...matched[1], tracks: [] }];
    renderPage('downloadId=D&source=lidarr&title=Pack');
    expect((await importButton(2)).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('No track assigned')).toBeDefined();

    await user.click(screen.getByRole('checkbox', { name: 'Import 02.flac' }));
    await user.click(await importButton(1));
    await waitFor(() => expect(submitted).not.toBeNull());
    expect((submitted!.files as Array<{ path: string }>).map((f) => f.path)).toEqual(['/downloads/album/01.flac']);
  });

  it('shows why the server refused the import', async () => {
    const user = userEvent.setup();
    const base = vi.mocked(fetch).getMockImplementation()!;
    renderPage('downloadId=D&source=lidarr&title=Pack');
    const submit = await importButton(2);
    vi.mocked(fetch).mockImplementation(async (url, init) => (init?.method === 'POST'
      ? Response.json({ error: 'Track id(s) not on release 73: 999' }, { status: 400 })
      : base(url as string, init)));
    const { toast } = await import('sonner');
    const error = vi.spyOn(toast, 'error');
    await user.click(submit);
    await waitFor(() => expect(error).toHaveBeenCalledWith('Track id(s) not on release 73: 999'));
    expect(mocks.back).not.toHaveBeenCalled();
  });
});
