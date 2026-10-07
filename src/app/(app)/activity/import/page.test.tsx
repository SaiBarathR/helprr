// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ search: new URLSearchParams(), back: vi.fn(), track: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.search, usePathname: () => '/activity/import' }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn(), back: mocks.back }) }));
vi.mock('@/lib/manual-import-tracker', () => ({ trackManualImport: mocks.track }));
import ManualImportPage from './page';

const episode = (id: number, episodeNumber: number) => ({ id, seasonNumber: 3, episodeNumber, title: `Episode ${episodeNumber}` });
// What Sonarr's manual import returns for a download it could not match as a
// whole: every file is still matched to its series, season and episode.
const sonarrFiles = [1, 2].map((n) => ({
  id: n, path: `/downloads/pack/Show - 0${n}.mkv`, name: `Show - 0${n}.mkv`, relativePath: `Show - 0${n}.mkv`,
  quality: { quality: { id: 7, name: 'Bluray-1080p' } }, languages: [{ id: 8, name: 'Japanese' }],
  series: { id: 47, title: 'Some Show' }, seasonNumber: 3, episodes: [episode(500 + n, n)], rejections: [],
  releaseGroup: 'grp', indexerFlags: 1, releaseType: 'singleEpisode',
}));
const radarrFiles = [{
  id: 1, path: '/downloads/Movie.2026.mkv', name: 'Movie.2026.mkv', relativePath: 'Movie.2026.mkv',
  quality: { quality: { id: 7, name: 'Bluray-1080p' } }, languages: [], movie: { id: 12, title: 'Movie' }, rejections: [],
  releaseGroup: 'grp', indexerFlags: 1,
}];

let root: Root;
let queryClient: QueryClient;
let files: unknown[];
let requests: string[];
let submitted: { source: string; files: Array<Record<string, unknown>> } | null;
let commands: Array<{ url: string; body: Record<string, unknown> }>;
let reprocessed: { source: string; instanceId?: string; items: Array<Record<string, unknown>> } | null;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  files = sonarrFiles;
  requests = [];
  submitted = null;
  commands = [];
  reprocessed = null;
  mocks.back.mockClear(); mocks.track.mockClear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    requests.push(url);
    if (init?.method === 'POST' && url.startsWith('/api/sonarr/command')) { commands.push({ url, body: JSON.parse(String(init.body)) }); return Response.json({}); }
    if (init?.method === 'POST' && url === '/api/activity/manualimport/reprocess') {
      reprocessed = JSON.parse(String(init.body));
      // As the *arr answers: the same items with what it worked out for the choice, and no series/movie object.
      return Response.json(reprocessed!.items.map((item, i) => ('seriesId' in item
        ? { id: item.id, path: item.path, seriesId: item.seriesId, seasonNumber: 1, episodes: [{ ...episode(900 + i, i + 1), seasonNumber: 1 }], languages: [{ id: 8, name: 'Japanese' }], releaseType: 'singleEpisode', rejections: [] }
        : { id: item.id, path: item.path, movieId: item.movieId, rejections: [] })));
    }
    if (url.startsWith('/api/sonarr?') || url === '/api/sonarr') return Response.json([{ id: 48, title: 'Other Show', year: 2020 }, { id: 47, title: 'Some Show', year: 2014 }]);
    if (url.startsWith('/api/radarr?') || url === '/api/radarr') return Response.json([{ id: 12, title: 'Movie', year: 2026 }]);
    if (init?.method === 'POST') { submitted = JSON.parse(String(init.body)); return Response.json({ id: 9 }); }
    // Out of order, as the *arr returns them.
    if (url.startsWith('/api/activity/manualimport')) return Response.json([...files].reverse());
    // Series 48 has its own episodes, so a picker fed from the wrong series is visible.
    if (url.startsWith('/api/sonarr/48/episodes')) return Response.json([episode(801, 1), episode(802, 2)]);
    if (/^\/api\/sonarr\/\d+\/episodes/.test(url)) return Response.json([episode(501, 1), episode(502, 2), episode(503, 3)]);
    return Response.json({});
  }));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  vi.unstubAllGlobals();
});

const wait = (ms: number) => act(async () => { await new Promise((done) => setTimeout(done, ms)); });
async function waitFor(check: () => void, timeout = 3000) {
  for (const start = Date.now(); ; await wait(10)) {
    try { check(); return; } catch (error) { if (Date.now() - start > timeout) throw error; }
  }
}
async function renderPage(query: string) {
  mocks.search = new URLSearchParams(query);
  await act(async () => root.render(<QueryClientProvider client={queryClient}><ManualImportPage /></QueryClientProvider>));
}
const text = () => document.body.textContent ?? '';
const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);

describe('manual import page', () => {
  it('imports a download the arr could not match using each file\'s own series match', async () => {
    // No seriesId in the link: the queue record of an unmatched download has none.
    await renderPage('downloadId=D&source=sonarr&instanceId=son-1&title=Pack');
    await waitFor(() => expect(text()).toContain('Import 2 Files'));
    // The pre-matched episodes are shown in path order, as in Sonarr's own dialog.
    expect([...text().matchAll(/S03E0\d/g)].map((m) => m[0])).toEqual(['S03E01', 'S03E02']);
    // The episode picker is fed from the files' series.
    await waitFor(() => expect(requests).toContain('/api/sonarr/47/episodes?instanceId=son-1'));
    // One series across the download, so the list-level refresh is offered for it.
    await act(async () => button('Refresh Episodes')!.click());
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0].body).toEqual({ name: 'RefreshSeries', seriesId: 47 });

    await act(async () => button('Import 2 Files')!.click());
    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted!.files).toEqual([
      expect.objectContaining({ path: '/downloads/pack/Show - 01.mkv', seriesId: 47, episodeIds: [501], seasonNumber: 3, downloadId: 'D' }),
      expect.objectContaining({ path: '/downloads/pack/Show - 02.mkv', seriesId: 47, episodeIds: [502], seasonNumber: 3, downloadId: 'D' }),
    ]);
    // What Sonarr matched for the file is what it must be told to record.
    expect(submitted!.files[0]).toMatchObject({ releaseGroup: 'grp', indexerFlags: 1, releaseType: 'singleEpisode' });
  });

  it('edits one file of a mixed download against that file\'s own series', async () => {
    // Two series in one download, returned out of path order: "Other" sorts before "Show".
    files = [
      sonarrFiles[0],
      { ...sonarrFiles[1], path: '/downloads/pack/Other - 01.mkv', name: 'Other - 01.mkv', relativePath: 'Other - 01.mkv', series: { id: 48, title: 'Other Show' }, episodes: [episode(801, 1)] },
    ];
    await renderPage('downloadId=D&source=sonarr&instanceId=son-1&title=Pack');
    await waitFor(() => expect(text()).toContain('Import 2 Files'));
    // With two series there is no single one for the list-level refresh to act on.
    expect(button('Refresh Episodes')).toBeUndefined();

    // Open the picker for the second listed file ("Show - 01", series 47).
    const change = [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('Change'));
    expect(change).toHaveLength(2);
    await act(async () => change[1].click());
    await waitFor(() => expect(text()).toContain('Select Episode'));
    await waitFor(() => expect(text()).toContain('Episode 3'));
    // Series 47's episodes, not series 48's two.
    expect(requests).toContain('/api/sonarr/47/episodes?instanceId=son-1');

    // Refresh acts on that file's series and instance.
    const refresh = [...document.querySelectorAll('button')].find((b) => b.querySelector('svg.lucide-refresh-cw'));
    await act(async () => refresh!.click());
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toEqual({ url: '/api/sonarr/command?instanceId=son-1', body: { name: 'RefreshSeries', seriesId: 47 } });

    // Pick another episode for it; the other file keeps its own match.
    const pick = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Episode 3'));
    await act(async () => pick!.click());
    await waitFor(() => expect(text()).toContain('Import 2 Files'));
    await act(async () => button('Import 2 Files')!.click());
    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted!.files).toEqual([
      expect.objectContaining({ path: '/downloads/pack/Other - 01.mkv', seriesId: 48, episodeIds: [801] }),
      expect.objectContaining({ path: '/downloads/pack/Show - 01.mkv', seriesId: 47, episodeIds: [503] }),
    ]);
  });

  it('lets the user choose the series when the arr could not match the files either', async () => {
    // What Sonarr returns when not even the file names match a series.
    files = [1, 2].map((n) => ({
      id: n, path: `/downloads/pack/[grp] Showw - 0${n}.mkv`, name: `[grp] Showw - 0${n}`, relativePath: `[grp] Showw - 0${n}.mkv`,
      quality: { quality: { id: 7, name: 'Bluray-1080p' } }, languages: [{ id: 0, name: 'Unknown' }],
      releaseType: 'unknown', indexerFlags: 0, rejections: [{ type: 'permanent', reason: 'Unknown Series' }],
    }));
    await renderPage('downloadId=D&source=sonarr&instanceId=son-1&title=Pack');
    await waitFor(() => expect(text()).toContain('Import 2 Files'));
    expect(text()).toContain('Sonarr could not match these files to a series.');
    expect(text()).toContain('Unknown Series');
    // Nothing to import into yet, and no episodes to pick until a series is chosen.
    expect(button('Import 2 Files')!.disabled).toBe(true);
    expect([...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('No episode assigned')).every((b) => b.disabled)).toBe(true);
    expect(text()).not.toContain('Change');

    await act(async () => button('Choose series')!.click());
    await waitFor(() => expect(text()).toContain('Select Series'));
    await waitFor(() => expect(text()).toContain('Some Show'));
    expect(requests).toContain('/api/sonarr?instanceId=son-1');
    const pick = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Some Show'));
    await act(async () => pick!.click());

    // The arr is asked to place exactly these files in that series.
    await waitFor(() => expect(reprocessed).not.toBeNull());
    expect(reprocessed).toMatchObject({ source: 'sonarr', instanceId: 'son-1' });
    expect(reprocessed!.items).toEqual([1, 2].map((n) => expect.objectContaining({
      id: n, path: `/downloads/pack/[grp] Showw - 0${n}.mkv`, downloadId: 'D', seriesId: 47, episodeIds: [],
    })));

    // Its answer pre-selects season and episodes, as its own dialog does.
    await waitFor(() => expect(text()).toContain('Matched to Some Show'));
    expect([...text().matchAll(/S01E0\d/g)].map((m) => m[0])).toEqual(['S01E01', 'S01E02']);
    expect(text()).not.toContain('Unknown Series');
    expect(button('Import 2 Files')!.disabled).toBe(false);

    await act(async () => button('Import 2 Files')!.click());
    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted!.files).toEqual([
      expect.objectContaining({ path: '/downloads/pack/[grp] Showw - 01.mkv', seriesId: 47, episodeIds: [900], seasonNumber: 1, languages: [{ id: 8, name: 'Japanese' }], releaseType: 'singleEpisode', downloadId: 'D' }),
      expect.objectContaining({ path: '/downloads/pack/[grp] Showw - 02.mkv', seriesId: 47, episodeIds: [901], seasonNumber: 1, downloadId: 'D' }),
    ]);
  });

  it('lets the user choose the movie when Radarr could not match the file', async () => {
    files = [{ ...radarrFiles[0], movie: undefined, rejections: [{ type: 'permanent', reason: 'Unknown Movie' }] }];
    await renderPage('downloadId=D&source=radarr&instanceId=rad-1&title=Movie');
    await waitFor(() => expect(text()).toContain('Radarr could not match this file to a movie.'));
    expect(button('Import File')!.disabled).toBe(true);

    await act(async () => button('Choose movie')!.click());
    await waitFor(() => expect(text()).toContain('Select Movie'));
    expect(requests).toContain('/api/radarr?instanceId=rad-1');
    const pick = await (async () => { await waitFor(() => expect(text()).toContain('2026')); return [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('2026')); })();
    await act(async () => pick!.click());
    await waitFor(() => expect(reprocessed).not.toBeNull());
    expect(reprocessed).toMatchObject({ source: 'radarr', instanceId: 'rad-1', items: [{ path: '/downloads/Movie.2026.mkv', movieId: 12, downloadId: 'D' }] });

    await waitFor(() => expect(text()).toContain('Matched to Movie'));
    await act(async () => button('Import File')!.click());
    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted).toMatchObject({ source: 'radarr', files: [{ path: '/downloads/Movie.2026.mkv', movieId: 12 }] });
  });

  it('keeps using the queue item\'s series when the link carries one', async () => {
    await renderPage('downloadId=D&source=sonarr&seriesId=9&title=Pack');
    await waitFor(() => expect(text()).toContain('Import 2 Files'));
    await waitFor(() => expect(requests).toContain('/api/sonarr/9/episodes'));
    await act(async () => button('Import 2 Files')!.click());
    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted!.files.map((f) => f.seriesId)).toEqual([9, 9]);
  });

  it('imports an unmatched Radarr download using the file\'s own movie match', async () => {
    files = radarrFiles;
    await renderPage('downloadId=D&source=radarr&title=Movie');
    await waitFor(() => expect(text()).toContain('Import File'));
    await act(async () => button('Import File')!.click());
    await waitFor(() => expect(submitted).not.toBeNull());
    expect(submitted).toMatchObject({ source: 'radarr', files: [{ path: '/downloads/Movie.2026.mkv', movieId: 12, downloadId: 'D', releaseGroup: 'grp', indexerFlags: 1 }] });
  });
});
