// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionProvider, type MePayload } from '@/components/permission-provider';
import type { Release } from '@/types';
// Real search results, trimmed, with example links and indexer names in place of the real ones:
// Sonarr matched the first release to S01E03 and couldn't match the second (Unknown Series).
import sonarrFixture from './__fixtures__/sonarr-releases-love-in-disguise-s01e03.json';
// Radarr matched the first and couldn't match the second (Unknown Movie).
import radarrFixture from './__fixtures__/radarr-releases-us-2019.json';

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('@/components/layout/navigation-provider', () => ({
  useAppRouter: () => ({ back: vi.fn(), push: vi.fn() }),
  canGoBackInApp: () => true,
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));

import { InteractiveSearch } from './interactive-search';
import { initialDraft } from './manual-grab';

const SONARR = sonarrFixture as unknown as Release[];
const RADARR = radarrFixture as unknown as Release[];
const [MATCHED, UNMATCHED] = SONARR;
const [MOVIE_MATCHED, MOVIE_UNMATCHED] = RADARR;

const SERIES = [{ id: 22, title: 'Love in Disguise (2026)', year: 2026 }, { id: 23, title: 'Other Show', year: 2020 }];
const EPISODES = [
  { id: 2475, seriesId: 22, seasonNumber: 1, episodeNumber: 1, title: 'Episode 1', absoluteEpisodeNumber: 1 },
  { id: 2477, seriesId: 22, seasonNumber: 1, episodeNumber: 3, title: 'Episode 3', absoluteEpisodeNumber: 3 },
  { id: 2478, seriesId: 22, seasonNumber: 1, episodeNumber: 4, title: 'Episode 4', absoluteEpisodeNumber: 4 },
];
const LANGUAGES = [{ id: 0, name: 'Unknown' }, { id: 1, name: 'English' }, { id: 21, name: 'Korean' }];
const QUALITY_DEFS = [{ id: 9, title: 'WEBDL-1080p', weight: 10, quality: { id: 3, name: 'WEBDL-1080p', source: 'web', resolution: 1080 } }];
const TORRENT = { id: 1, name: 'qBittorrent', enable: true, protocol: 'torrent', priority: 1, implementation: 'QBittorrent' };

let clients: unknown[];
let grabResponse: () => Response;
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;

function me(caps: Record<string, boolean>, role: 'admin' | 'member' = 'member'): MePayload {
  return {
    id: 'u', name: 'U', role, template: role, capabilities: caps, seerrConfigured: false, tmdbConfigured: false,
    seerrUserId: null, jellyfinLinked: false, jellyfinConfigured: false, twitchConfigured: false, youtubeConfigured: false,
    jellyfinConnected: false, hasLocalPassword: true, customHeadersEnabled: false,
  };
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  // vaul captures the pointer on a drag start; jsdom has no pointer capture.
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});
beforeEach(() => {
  vi.clearAllMocks();
  clients = [TORRENT];
  grabResponse = () => Response.json({ success: true });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return grabResponse();
    const path = url.split('?')[0];
    if (path.endsWith('/downloadclient')) return Response.json(clients);
    if (path.endsWith('/languages')) return Response.json(LANGUAGES);
    if (path.endsWith('/qualitydefinitions')) return Response.json(QUALITY_DEFS);
    if (path === '/api/sonarr/22/episodes') return Response.json(EPISODES);
    if (path === '/api/sonarr/23/episodes') return Response.json([]);
    if (path === '/api/sonarr') return Response.json(SERIES);
    if (path === '/api/radarr') return Response.json([{ id: 116, title: 'Us', year: 2019 }]);
    if (path === '/api/sonarr/release') return Response.json(SONARR);
    if (path === '/api/radarr/release') return Response.json(RADARR);
    if (path === '/api/lidarr/release') return Response.json([{ ...MATCHED, guid: 'album-1', title: 'Album.FLAC', downloadAllowed: false }]);
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderEpisodeSearch(user = me({ 'activity.manage': true, 'series.view': true })) {
  return render(
    <PermissionProvider value={user}>
      <QueryClientProvider client={client}>
        <InteractiveSearch
          service="sonarr"
          subtitle="Love in Disguise - S01E03"
          searchParams={{ episodeId: '2477', instanceId: 'son-1' }}
          searchedItem={{ seriesId: '22', seasonNumber: '1', episodeId: '2477' }}
        />
      </QueryClientProvider>
    </PermissionProvider>,
  );
}
function renderMovieSearch() {
  return render(
    <PermissionProvider value={me({ 'activity.manage': true, 'movies.view': true })}>
      <QueryClientProvider client={client}>
        <InteractiveSearch service="radarr" subtitle="Us" searchParams={{ movieId: '116', instanceId: 'rad-1' }} searchedItem={{ movieId: '116' }} />
      </QueryClientProvider>
    </PermissionProvider>,
  );
}

const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
const lastBody = () => JSON.parse(String(posts().at(-1)![1].body));
// The two releases share a title apart from case and quality, so rows are found by their quality badge.
async function rowWith(text: string) {
  return (await screen.findByText(text)).closest('.rounded-lg') as HTMLElement;
}
async function openManualGrab(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(within(await rowWith(title)).getByRole('button', { name: 'Override and add to download queue' }));
  return screen.findByRole('dialog', { name: 'Manual grab' });
}

describe('a release Sonarr matched', () => {
  it('grabs at once, as before, and the row then shows it was added', async () => {
    const user = userEvent.setup();
    renderEpisodeSearch();
    const row = await rowWith(MATCHED.title);
    await user.click(within(row).getByRole('button', { name: 'Add to download queue' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Added to download queue'));
    expect(lastBody()).toEqual({ guid: MATCHED.guid, indexerId: MATCHED.indexerId });
    const done = within(row).getByRole('button', { name: 'Added to download queue' }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('opens Manual grab when Sonarr says it needs one after all', async () => {
    const user = userEvent.setup();
    grabResponse = () => Response.json({ error: 'Sonarr couldn’t tell…', code: 'unmatched' }, { status: 422 });
    renderEpisodeSearch();
    await user.click(within(await rowWith(MATCHED.title)).getByRole('button', { name: 'Add to download queue' }));
    expect(await screen.findByRole('dialog', { name: 'Manual grab' })).toBeTruthy();
  });

  it('marks a failed grab on its row and lets it be tried again', async () => {
    const user = userEvent.setup();
    const why = "The release couldn't be fetched, or the download client refused it. Try another one.";
    grabResponse = () => Response.json({ error: why, code: 'indexer' }, { status: 502 });
    renderEpisodeSearch();
    const row = await rowWith(MATCHED.title);
    await user.click(within(row).getByRole('button', { name: 'Add to download queue' }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(why));
    // Said to screen readers too: a phone shows no tooltip.
    const retry = within(row).getByRole('button', { name: `Grab failed: ${why}. Add to download queue` }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    await user.click(retry);
    await waitFor(() => expect(posts()).toHaveLength(2));
  });

  it('offers a new search when the result has expired', async () => {
    const user = userEvent.setup();
    grabResponse = () => Response.json({ error: 'This result has expired. Search again.', code: 'expired' }, { status: 410 });
    renderEpisodeSearch();
    await user.click(within(await rowWith(MATCHED.title)).getByRole('button', { name: 'Add to download queue' }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(
      'This result has expired. Search again.', expect.objectContaining({ action: expect.objectContaining({ label: 'Search again' }) }),
    ));
  });
});

describe('a release Sonarr could not match', () => {
  it('asks first, and Cancel grabs nothing', async () => {
    const user = userEvent.setup();
    renderEpisodeSearch();
    await user.click(within(await rowWith(UNMATCHED.title)).getByRole('button', { name: 'Add to download queue' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Grab release?' });
    expect(within(ask).getByText(/Sonarr couldn't tell which series and episode this release is for/)).toBeTruthy();
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(posts()).toHaveLength(0);
  });

  it('Grab anyway sends the episode that was searched for, as Sonarr does', async () => {
    const user = userEvent.setup();
    renderEpisodeSearch();
    await user.click(within(await rowWith(UNMATCHED.title)).getByRole('button', { name: 'Add to download queue' }));
    await user.click(await screen.findByRole('button', { name: 'Grab anyway' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Added to download queue'));
    expect(posts()[0][0]).toBe('/api/sonarr/release?episodeId=2477&instanceId=son-1');
    expect(lastBody()).toEqual({ guid: UNMATCHED.guid, indexerId: UNMATCHED.indexerId, episodeId: 2477 });
  });

  it('Choose manually opens Manual grab filled in from the search, and grabs it as shown', async () => {
    const user = userEvent.setup();
    renderEpisodeSearch();
    await user.click(within(await rowWith(UNMATCHED.title)).getByRole('button', { name: 'Add to download queue' }));
    await user.click(await screen.findByRole('button', { name: 'Choose manually' }));
    const sheet = await screen.findByRole('dialog', { name: 'Manual grab' });
    expect(await within(sheet).findByText('Love in Disguise (2026)')).toBeTruthy();
    expect(within(sheet).getByText('Season 1')).toBeTruthy();
    expect(await within(sheet).findByText('3 – Episode 3')).toBeTruthy();
    expect(within(sheet).getByText('WEBDL-720p')).toBeTruthy();
    // Sonarr reads no language from this title: "Unknown", which it accepts.
    expect(within(sheet).getByText('Unknown')).toBeTruthy();
    expect(within(sheet).getByText(/filled in from your search/)).toBeTruthy();
    // One torrent client: nothing to choose, as in Sonarr.
    expect(within(sheet).queryByText('Download client')).toBeNull();

    await user.click(within(sheet).getByRole('button', { name: 'Grab release' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Added to download queue'));
    expect(lastBody()).toEqual({
      guid: UNMATCHED.guid, indexerId: UNMATCHED.indexerId, shouldOverride: true, seriesId: 22, episodeIds: [2477],
      quality: UNMATCHED.quality, languages: [{ id: 0, name: 'Unknown' }],
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Manual grab' })).toBeNull());
  });
});

describe('Manual grab', () => {
  it('starts from Sonarr’s own match when it made one', async () => {
    const user = userEvent.setup();
    renderEpisodeSearch();
    const sheet = await openManualGrab(user, MATCHED.title);
    expect(await within(sheet).findByText('3 – Episode 3')).toBeTruthy();
    expect(within(sheet).queryByText(/filled in from your search/)).toBeNull();
  });

  it('picks several episodes on the full-screen list, hiding the results meanwhile', async () => {
    const user = userEvent.setup();
    renderEpisodeSearch();
    const sheet = await openManualGrab(user, UNMATCHED.title);
    await user.click(await within(sheet).findByRole('button', { name: /Episodes/ }));
    expect(await screen.findByRole('heading', { name: 'Select Episode(s)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Interactive Search', hidden: true }).closest('[hidden]')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Episode 4/ }));
    await user.click(screen.getByRole('button', { name: 'Select (2)' }));
    const back = await screen.findByRole('dialog', { name: 'Manual grab' });
    expect(within(back).getByText('4 – Episode 4')).toBeTruthy();
    await user.click(within(back).getByRole('button', { name: 'Grab release' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(lastBody().episodeIds).toEqual([2477, 2478]);
  });

  it('clears season and episodes when another series is chosen, and says what is missing', async () => {
    const user = userEvent.setup();
    renderEpisodeSearch();
    const sheet = await openManualGrab(user, UNMATCHED.title);
    await user.click(await within(sheet).findByRole('button', { name: /^Series/ }));
    await user.click(await screen.findByRole('button', { name: /Other Show/ }));
    const back = await screen.findByRole('dialog', { name: 'Manual grab' });
    expect(within(back).getByText('Other Show')).toBeTruthy();
    expect(within(back).getByText('Choose a season')).toBeTruthy();
    expect(within(back).getByText('Choose episodes')).toBeTruthy();
    await user.click(within(back).getByRole('button', { name: 'Grab release' }));
    expect(within(back).getByRole('alert').textContent).toBe('Choose at least one episode');
    expect(posts()).toHaveLength(0);
  });

  it('opens the language list on the release’s own languages', async () => {
    const user = userEvent.setup();
    renderEpisodeSearch();
    const sheet = await openManualGrab(user, UNMATCHED.title);
    await user.click(within(sheet).getByRole('button', { name: /Languages/ }));
    const picker = await screen.findByRole('dialog', { name: 'Select Language' });
    await waitFor(() => expect(within(picker).getByRole('button', { name: 'English' })).toBeTruthy());
    expect(within(picker).getByRole('button', { name: 'Unknown' }).querySelector('svg')).toBeTruthy();
    expect(within(picker).getByRole('button', { name: 'English' }).querySelector('svg')).toBeNull();
    await user.click(within(picker).getByRole('button', { name: 'English' }));
    await user.click(within(picker).getByRole('button', { name: 'Select Languages' }));
    expect(await within(sheet).findByText('Unknown, English')).toBeTruthy();
  });

  it('offers only the release’s own kind of download client, when there is a choice', async () => {
    const user = userEvent.setup();
    clients = [
      TORRENT,
      { ...TORRENT, id: 2, name: 'Deluge' },
      { ...TORRENT, id: 3, name: 'SABnzbd', protocol: 'usenet' },
      { ...TORRENT, id: 4, name: 'Off', enable: false },
    ];
    renderEpisodeSearch();
    const sheet = await openManualGrab(user, UNMATCHED.title);
    await user.click(await within(sheet).findByRole('button', { name: /Download client/ }));
    const picker = await screen.findByRole('dialog', { name: 'Download client' });
    expect(within(picker).queryByText('SABnzbd')).toBeNull();
    expect(within(picker).queryByText('Off')).toBeNull();
    await user.click(within(picker).getByRole('button', { name: 'Deluge' }));
    expect(await within(sheet).findByText('Deluge')).toBeTruthy();
    await user.click(within(sheet).getByRole('button', { name: 'Grab release' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(lastBody().downloadClientId).toBe(2);
  });

  it('keeps an expired result’s message in the sheet, with Search again', async () => {
    const user = userEvent.setup();
    grabResponse = () => Response.json({ error: 'This result has expired. Search again.', code: 'expired' }, { status: 410 });
    renderEpisodeSearch();
    const sheet = await openManualGrab(user, UNMATCHED.title);
    await user.click(within(sheet).getByRole('button', { name: 'Grab release' }));
    expect((await within(sheet).findByRole('alert')).textContent).toContain('This result has expired. Search again.');
    const searchesBefore = fetchMock.mock.calls.filter(([url, init]) => String(url).startsWith('/api/sonarr/release') && !init?.method).length;
    await user.click(within(sheet).getByRole('button', { name: 'Search again' }));
    await waitFor(() => expect(
      fetchMock.mock.calls.filter(([url, init]) => String(url).startsWith('/api/sonarr/release') && !init?.method).length,
    ).toBe(searchesBefore + 1));
  });

  it('without ?instance=, offers the default instance’s library: the grab goes there', async () => {
    const user = userEvent.setup();
    const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (url === '/api/instances'
      ? Response.json([
        { id: 'son-other', type: 'SONARR', label: 'Anime', isDefault: false },
        { id: 'son-main', type: 'SONARR', label: 'Main', isDefault: true },
        { id: 'rad-main', type: 'RADARR', label: 'Main', isDefault: true },
      ])
      : base(url, init)));
    render(
      <PermissionProvider value={me({ 'activity.manage': true, 'series.view': true })}>
        <QueryClientProvider client={client}>
          <InteractiveSearch
            service="sonarr" subtitle="Love in Disguise - S01E03"
            searchParams={{ episodeId: '2477' }} searchedItem={{ seriesId: '22', seasonNumber: '1', episodeId: '2477' }}
          />
        </QueryClientProvider>
      </PermissionProvider>,
    );
    const sheet = await openManualGrab(user, UNMATCHED.title);
    expect(await within(sheet).findByText('Love in Disguise (2026)')).toBeTruthy();
    const libraryCalls = fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.split('?')[0] === '/api/sonarr');
    expect(libraryCalls).toEqual(['/api/sonarr?instanceId=son-main']);
  });

  it('without library access, keeps the searched series fixed but the rest editable', async () => {
    const user = userEvent.setup();
    renderEpisodeSearch(me({ 'activity.manage': true, 'series.view': false }));
    const sheet = await openManualGrab(user, UNMATCHED.title);
    const seriesRow = within(sheet).getByRole('button', { name: /^Series/ }) as HTMLButtonElement;
    expect(seriesRow.disabled).toBe(true);
    // Not the release's own title: that is what Sonarr couldn't match.
    expect(seriesRow.textContent).toContain('The series you searched for');
    expect(fetchMock.mock.calls.some(([url]) => String(url).split('?')[0] === '/api/sonarr')).toBe(false);
    expect(await within(sheet).findByText('3 – Episode 3')).toBeTruthy();
    // Editing the episodes keeps the series named for what it is.
    await user.click(within(sheet).getByRole('button', { name: /^Episodes/ }));
    await user.click(await screen.findByRole('button', { name: /Episode 4/ }));
    await user.click(screen.getByRole('button', { name: 'Select (2)' }));
    const back = await screen.findByRole('dialog', { name: 'Manual grab' });
    expect(within(back).getByRole('button', { name: /^Series/ }).textContent).toContain('The series you searched for');
    await user.click(within(back).getByRole('button', { name: 'Grab release' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(lastBody()).toMatchObject({ shouldOverride: true, seriesId: 22, episodeIds: [2477, 2478] });
  });
});

describe('Radarr', () => {
  it('Grab anyway sends the movie that was searched for', async () => {
    const user = userEvent.setup();
    renderMovieSearch();
    await user.click(within(await rowWith(MOVIE_UNMATCHED.title)).getByRole('button', { name: 'Add to download queue' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Grab release?' });
    expect(within(ask).getByText(/Radarr couldn't tell which movie this release is for/)).toBeTruthy();
    await user.click(within(ask).getByRole('button', { name: 'Grab anyway' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(lastBody()).toEqual({ guid: MOVIE_UNMATCHED.guid, indexerId: MOVIE_UNMATCHED.indexerId, movieId: 116 });
  });

  it('Manual grab chooses the movie, quality and languages', async () => {
    const user = userEvent.setup();
    renderMovieSearch();
    const sheet = await openManualGrab(user, MOVIE_UNMATCHED.title);
    expect(await within(sheet).findByText('Us')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: /^Season/ })).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: 'Grab release' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(lastBody()).toEqual({
      guid: MOVIE_UNMATCHED.guid, indexerId: MOVIE_UNMATCHED.indexerId, shouldOverride: true, movieId: 116,
      quality: MOVIE_UNMATCHED.quality, languages: MOVIE_UNMATCHED.languages,
    });
  });

  it('a matched movie release still grabs with one tap', async () => {
    const user = userEvent.setup();
    renderMovieSearch();
    await user.click(within(await rowWith(MOVIE_MATCHED.title)).getByRole('button', { name: 'Add to download queue' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(lastBody()).toEqual({ guid: MOVIE_MATCHED.guid, indexerId: MOVIE_MATCHED.indexerId });
  });
});

describe('Lidarr: plain grab and download-client override, as before', () => {
  function renderAlbumSearch() {
    return render(
      <PermissionProvider value={me({ 'activity.manage': true, 'music.view': true })}>
        <QueryClientProvider client={client}>
          <InteractiveSearch service="lidarr" subtitle="Album" searchParams={{ albumId: '31', instanceId: 'lid-1' }} />
        </QueryClientProvider>
      </PermissionProvider>,
    );
  }

  it('grabs without asking and overrides only the download client', async () => {
    const user = userEvent.setup();
    renderAlbumSearch();
    const row = await rowWith('Album.FLAC');
    await user.click(within(row).getByRole('button', { name: 'Add to download queue' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(lastBody()).toEqual({ guid: 'album-1', indexerId: MATCHED.indexerId });

    await user.click(within(row).getByRole('button', { name: 'Override and add to download queue' }));
    const dialog = await screen.findByRole('dialog', { name: 'Override Download Client' });
    await user.click(await within(dialog).findByRole('button', { name: /qBittorrent/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Grab with Override' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(lastBody()).toEqual({ guid: 'album-1', indexerId: MATCHED.indexerId, downloadClientId: 1 });
    expect(screen.queryByRole('dialog', { name: 'Manual grab' })).toBeNull();
  });
});

describe('what Manual grab starts with', () => {
  const unmatched = { ...UNMATCHED, mappedSeriesId: undefined, mappedEpisodeInfo: [] } as Release;

  it('takes Sonarr’s own match over the search', () => {
    expect(initialDraft('sonarr', MATCHED, { seriesId: 99, seasonNumber: 2, episodeId: 5 })).toMatchObject({
      seriesId: 22, seasonNumber: 1, episodeIds: [2477], fromSearch: false,
    });
  });

  it('else the searched episode', () => {
    expect(initialDraft('sonarr', unmatched, { seriesId: 22, seasonNumber: 1, episodeId: 2477 })).toMatchObject({
      seriesId: 22, seasonNumber: 1, episodeIds: [2477], fromSearch: true,
    });
  });

  it('on a season search, the episodes the title names in that season, or the whole pack', () => {
    expect(initialDraft('sonarr', unmatched, { seriesId: 22, seasonNumber: 1 })).toMatchObject({ episodeIds: null, pendingEpisodes: [3] });
    expect(initialDraft('sonarr', { ...unmatched, fullSeason: true, episodeNumbers: [] }, { seriesId: 22, seasonNumber: 1 }))
      .toMatchObject({ episodeIds: null, pendingEpisodes: 'all' });
    expect(initialDraft('sonarr', { ...unmatched, seasonNumber: 2 }, { seriesId: 22, seasonNumber: 1 })).toMatchObject({ pendingEpisodes: [] });
  });

  it('blank with nothing to go on; Radarr takes its match, else the searched movie', () => {
    const blank = initialDraft('sonarr', unmatched, {});
    expect(blank.seriesId).toBeUndefined();
    expect(blank).toMatchObject({ episodeIds: [], fromSearch: false });
    expect(initialDraft('radarr', MOVIE_MATCHED, { movieId: 5 })).toMatchObject({ movieId: 116, fromSearch: false });
    expect(initialDraft('radarr', MOVIE_UNMATCHED, { movieId: 116 })).toMatchObject({ movieId: 116, fromSearch: true });
  });

  it('always has a full quality revision, which the grab route requires', () => {
    expect(initialDraft('radarr', { ...MOVIE_UNMATCHED, quality: { quality: { id: 3, name: 'X' } } }, {}).quality)
      .toEqual({ quality: { id: 3, name: 'X' }, revision: { version: 1, real: 0, isRepack: false } });
  });
});
