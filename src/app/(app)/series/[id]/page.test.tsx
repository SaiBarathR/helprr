// @vitest-environment jsdom
// Characterization tests for the series detail page: what it shows and what it
// sends, pinned before the page is split into smaller modules (Workstream 15).
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  caps: new Set<string>(),
  role: 'admin' as 'admin' | 'member',
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  search: 'instance=son-1',
  routes: {} as Record<string, (init?: RequestInit, url?: URL) => Response>,
  sent: [] as Array<{ method: string; path: string; body: unknown }>,
  remapOpen: false,
  remapResult: null as unknown,
  // Render each quick context menu's actions next to its trigger.
  contextMenus: false,
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '7' }),
  useSearchParams: () => new URLSearchParams(mocks.search),
  usePathname: () => '/series/7',
}));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: mocks.push, replace: vi.fn(), back: vi.fn() }) }));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap), useMe: () => ({ role: mocks.role }) }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/lib/arr-command', () => ({ pollCommand: vi.fn(async () => 'completed') }));
vi.mock('@/lib/hooks/use-external-urls', () => ({
  useExternalUrls: () => ({ JELLYFIN: 'https://jellyfin.example' }),
  useExternalUrlResolver: () => () => 'https://sonarr.example',
}));
vi.mock('@/lib/hooks/use-reference-data', () => ({
  useQualityProfiles: () => ({ data: [{ id: 4, name: 'HD-1080p' }] }),
  useRootFolders: () => ({ data: [{ id: 1, path: '/tv' }] }),
  useTags: () => ({ data: [{ id: 9, label: 'kids' }, { id: 10, label: 'unused' }] }),
}));
vi.mock('@/components/jellyfin/watch-status-provider', () => ({
  hasWatchLookupIdentity: () => true,
  useWatchLookup: () => () => null,
  useWatchStatus: () => ({ setWatched: vi.fn(), canWrite: false, isWriting: false }),
}));
vi.mock('@/components/jellyfin/use-series-episode-watch', () => ({
  useSeriesEpisodeWatch: () => ({ episodes: { S1E1: { played: true }, S1E2: { played: true }, S2E1: { played: false } } }),
}));
// Plain stand-ins for menus, drawers and the heavy children: the page's own markup stays real.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div data-testid="menu">{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick, asChild, disabled }: { children: React.ReactNode; onClick?: () => void; asChild?: boolean; disabled?: boolean }) =>
    asChild ? <div role="menuitem">{children}</div> : <button role="menuitem" onClick={onClick} disabled={disabled}>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
}));
vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
  DrawerContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DrawerHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DrawerTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DrawerDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DrawerFooter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DrawerClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
type MockContextAction = { id: string; label: string; href?: string; onSelect?: () => void; disabled?: boolean };
vi.mock('@/components/ui/quick-context-menu', () => ({
  QuickContextMenu: ({ children, label, actions, groups }: { children: React.ReactNode; label: string; actions?: MockContextAction[]; groups?: Array<{ actions: MockContextAction[] }> }) => (
    <>
      {children}
      {mocks.contextMenus && (
        <div role="group" aria-label={label}>
          {[...(actions ?? []), ...(groups ?? []).flatMap((group) => group.actions)].map((action) => (action.href
            ? <a key={action.id} href={action.href}>{action.label}</a>
            : <button key={action.id} type="button" onClick={action.onSelect} disabled={action.disabled}>{action.label}</button>))}
        </div>
      )}
    </>
  ),
}));
vi.mock('@/components/media/virtualized-person-rail', () => ({
  VirtualizedPersonRail: ({ title, items, viewAllHref }: { title: string; items: Array<{ name: string; subtitle: string }>; viewAllHref: string }) => (
    <section aria-label={title}><a href={viewAllHref}>{title}</a>{items.map((item) => <span key={item.name}>{item.name} ({item.subtitle})</span>)}</section>
  ),
}));
vi.mock('@/components/discover/discover-info-rows', () => ({
  DiscoverInfoRows: ({ title, rows }: { title: string; rows: Array<{ label: string; value: string; valueNode?: React.ReactNode }> }) => (
    <section aria-label={title}>{rows.map((row) => <div key={row.label}>{row.label}: {row.valueNode ?? row.value}</div>)}</section>
  ),
}));
vi.mock('@/components/discover/discover-video-rail', () => ({ DiscoverVideoRail: ({ title }: { title: string }) => <section aria-label={title} /> }));
vi.mock('@/components/discover/discover-media-rail', () => ({ DiscoverMediaRail: ({ title }: { title: string }) => <section aria-label={title} /> }));
vi.mock('@/components/discover/discover-watch-providers', () => ({ DiscoverWatchProvidersSection: () => <section aria-label="Where to watch" /> }));
vi.mock('@/components/anime/anime-hero', () => ({
  AnimeHero: ({ title, nextAiringSeconds }: { title: string; nextAiringSeconds: string }) => <header aria-label="Anime hero">{title} · next in {nextAiringSeconds}</header>,
}));
vi.mock('@/components/anime/anime-character-rail', () => ({ AnimeCharacterRail: () => <section aria-label="Characters" /> }));
vi.mock('@/components/anime/anime-relations-section', () => ({ AnimeRelationsSection: () => <section aria-label="Relations" /> }));
vi.mock('@/components/anime/anime-media-rail', () => ({ AnimeMediaRail: ({ title }: { title: string }) => <section aria-label={`Anime ${title}`} /> }));
vi.mock('@/components/anime/anime-trailer-rail', () => ({ AnimeTrailerRail: () => <section aria-label="Trailer" /> }));
vi.mock('@/components/anime/anilist-status-panel', () => ({ AnilistStatusPanel: ({ mediaTitle }: { mediaTitle: string }) => <section aria-label="AniList status">{mediaTitle}</section> }));
vi.mock('@/components/anime/anilist-remap-drawer', () => ({
  AniListRemapDrawer: ({ open, details, onUpdated }: { open: boolean; details: Array<{ id: number }>; onUpdated: (next: unknown) => void }) => {
    mocks.remapOpen = open;
    return open ? (
      <div role="dialog" aria-label="Remap AniList drawer">
        <span>Drawer details: {details.map((detail) => detail.id).join(',')}</span>
        <button type="button" onClick={() => onUpdated(mocks.remapResult)}>Apply mapping</button>
      </div>
    ) : null;
  },
}));
vi.mock('@/components/media/media-download-progress', () => ({ MediaDownloadProgress: () => null }));
vi.mock('@/components/jellyfin/play-in-helprr-button', () => ({ PlayInHelprrButton: () => <button>Play in Helprr</button> }));
vi.mock('@/components/jellyfin/mark-watched-button', () => ({ MarkWatchedMenuItem: () => null }));
vi.mock('@/components/jellyfin/watch-status-indicator', () => ({ EpisodeWatchIndicator: () => null }));
vi.mock('@/components/watchlist/watchlist-add-dialog', () => ({ WatchlistAddDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Add to watchlist dialog" /> : null) }));
vi.mock('@/components/scheduled-alerts/scheduled-alert-dialog', () => ({
  ScheduledAlertDialog: ({ open, draft }: { open: boolean; draft: { releaseDate: string | null; href: string } }) =>
    (open ? <div role="dialog" aria-label="Schedule alert dialog">{draft.href} {draft.releaseDate}</div> : null),
}));
vi.mock('@/components/media/rename-preview-dialog', () => ({ RenamePreviewDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Rename preview" /> : null) }));
vi.mock('@/components/media/interactive-search-dialog', () => ({
  InteractiveSearchDialog: ({ open, title, searchParams }: { open: boolean; title: string; searchParams: Record<string, unknown> }) =>
    (open ? <div role="dialog" aria-label="Interactive search">{title} {JSON.stringify(searchParams)}</div> : null),
}));

import SeriesDetailPage from './page';

const season = (seasonNumber: number, monitored: boolean, stats: Record<string, unknown> = {}) => ({
  seasonNumber, monitored,
  statistics: { episodeFileCount: 2, episodeCount: 3, totalEpisodeCount: 3, sizeOnDisk: 2_000_000_000, percentOfEpisodes: 66.666, previousAiring: '2024-03-02T20:00:00Z', releaseGroups: ['GRP'], ...stats },
});
function standardSeries(extra: Record<string, unknown> = {}) {
  return {
    id: 7, title: 'Severance', seriesType: 'standard', tmdbId: 95396, tvdbId: 371980, imdbId: 'tt11280740', titleSlug: 'severance',
    monitored: true, status: 'continuing', year: 2022, runtime: 55, certification: 'TV-MA', ratings: { value: 8.7 },
    images: [{ coverType: 'poster', url: '/api/images/poster.jpg', remoteUrl: 'https://img.example/poster.jpg' }],
    qualityProfileId: 4, tags: [9], path: '/tv/Severance', seasonFolder: true, added: '2022-02-18T10:00:00Z',
    network: 'Apple TV+', genres: ['Drama', 'Mystery'], nextAiring: null, overview: 'Mark leads a team of office workers whose memories have been surgically divided between their work and personal lives.',
    firstAired: '2022-02-18', lastAired: '2025-03-21', previousAiring: '2025-03-21T01:00:00Z', releaseDate: null, originalLanguage: { name: 'English' },
    seasons: [season(0, false, { episodeFileCount: 0, episodeCount: 0, totalEpisodeCount: 1, sizeOnDisk: 0, percentOfEpisodes: 0, previousAiring: null, releaseGroups: [] }), season(1, true), season(2, false)],
    statistics: { seasonCount: 2, episodeFileCount: 4, episodeCount: 6, totalEpisodeCount: 7, sizeOnDisk: 4_000_000_000, releaseGroups: ['GRP'], percentOfEpisodes: 66.6667 },
    ...extra,
  };
}
const episodes = [
  { id: 101, seriesId: 7, seasonNumber: 1, episodeNumber: 1, title: 'Good News About Hell', hasFile: true },
  { id: 102, seriesId: 7, seasonNumber: 1, episodeNumber: 2, title: 'Half Loop', hasFile: true },
  { id: 103, seriesId: 7, seasonNumber: 1, episodeNumber: 3, title: 'In Perpetuity', hasFile: false },
  { id: 201, seriesId: 7, seasonNumber: 2, episodeNumber: 1, title: 'Hello, Ms. Cobel', hasFile: true },
  { id: 202, seriesId: 7, seasonNumber: 2, episodeNumber: 2, title: 'Goodbye, Mrs. Selvig', hasFile: true },
  { id: 203, seriesId: 7, seasonNumber: 2, episodeNumber: 3, title: 'Who Is Alive?', hasFile: false },
];
const tmdb = {
  backdropPath: 'https://image.tmdb.org/t/p/original/backdrop.jpg', tagline: 'Work is a mystery.', releaseDate: '2022-02-18', originCountry: ['US'],
  originalLanguage: 'en', showType: 'Scripted', nextEpisode: { seasonNumber: 3, episodeNumber: 1, name: 'Untitled', airDate: '2026-11-01' },
  createdBy: [{ id: 1, name: 'Dan Erickson' }],
  seasons: [{ seasonNumber: 1, posterPath: '/s1.jpg', voteAverage: 8.4, overview: 'Mark is promoted.' }, { seasonNumber: 2, posterPath: null, voteAverage: 0, overview: '' }],
  videos: [{ key: 'a' }], recommendations: [{ id: 1 }], similar: [], watchProviders: { link: 'x' },
  networks: [{ id: 2552, name: 'Apple TV+', logoPath: '/apple.png' }], productionCompanies: [{ id: 3, name: 'Red Hour', logoPath: null }],
};
const credits = { cast: [{ id: 1, name: 'Adam Scott', profilePath: null, character: 'Mark Scout', episodeCount: 19 }], crew: [{ id: 2, name: 'Ben Stiller', profilePath: null, job: 'Director' }] };

function animeDetail(id: number, extra: Record<string, unknown> = {}) {
  return {
    id, title: 'Frieren: Beyond Journey\'s End', titleRomaji: 'Sousou no Frieren', titleNative: '葬送のフリーレン', synonyms: ['Frieren'], format: 'TV', countryOfOrigin: 'JP',
    episodes: 28, duration: 24, status: 'FINISHED', startDate: { year: 2023, month: 9, day: 29 }, endDate: { year: 2024, month: 3, day: 22 },
    season: 'FALL', seasonYear: 2023, averageScore: 91, meanScore: 91, popularity: 400000, favourites: 50000,
    studios: [{ id: 11, name: 'Madhouse', isMain: true }, { id: 12, name: 'Aniplex', isMain: false }], source: 'MANGA', hashtag: '#frieren',
    description: 'An elf <i>mage</i> outlives her party.', bannerImage: null, coverImage: null, genres: ['Adventure', 'Fantasy'],
    tags: [{ name: 'Elf', rank: 95, isSpoiler: false }, { name: 'Twist', rank: 80, isSpoiler: true }], characters: [], relations: [], recommendations: [],
    staff: [{ id: 99, name: 'Keiichirou Saitou', role: 'Director', image: null }], rankings: [{ id: 1, rank: 3, type: 'RATED', context: 'highest rated all time', allTime: true }],
    statusDistribution: [{ status: 'CURRENT', amount: 30 }, { status: 'COMPLETED', amount: 70 }], scoreDistribution: [{ score: 90, amount: 10 }, { score: 40, amount: 1 }],
    nextAiringEpisode: null, malId: 52991, trailer: null, externalLinks: [{ id: 5, site: 'Crunchyroll', url: 'https://cr.example/frieren' }], ...extra,
  };
}
function animePayload(entries: Array<{ anilistMediaId: number; titleSnapshot: string }>, state = 'AUTO_MATCH') {
  return { mapping: { state, entries }, details: entries.length ? [animeDetail(entries[0].anilistMediaId)] : [] };
}

let caseCounter = 0;
beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  caseCounter += 1;
  // A route of its own per test: the page keeps per-route view state in memory.
  mocks.search = `instance=son-1&case=${caseCounter}`;
  mocks.caps = new Set(['activity.manage', 'series.editMonitoring', 'series.editTags', 'series.changePath', 'series.add', 'series.delete', 'series.manageFiles', 'scheduledAlerts.edit', 'anime.view', 'discover.view']);
  mocks.role = 'admin';
  mocks.sent = [];
  mocks.remapResult = null;
  mocks.contextMenus = false;
  mocks.routes = {
    'GET /api/sonarr/7': () => Response.json(standardSeries()),
    'GET /api/sonarr/7/episodes': () => Response.json(episodes),
    'GET /api/sonarr/7/credits': () => Response.json(credits),
    'GET /api/discover/tv/95396': () => Response.json(tmdb),
    'GET /api/discover/tv/95396/season/1': () => Response.json({ episodes: [{ id: 1, episodeNumber: 1, name: 'Good News About Hell', stillPath: null, airDate: '2022-02-18', runtime: 57, voteAverage: 8.1, overview: 'Mark is promoted.' }, { id: 4, episodeNumber: 4, name: 'The You You Are', stillPath: null, airDate: null, runtime: null, voteAverage: 0, overview: '' }] }),
    'PUT /api/sonarr/7': (init) => Response.json(JSON.parse(String(init!.body))),
    'POST /api/sonarr/command': () => Response.json({ id: 55 }),
    'DELETE /api/sonarr/7': () => new Response(null, { status: 200 }),
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), 'http://helprr.test');
    const method = init?.method ?? 'GET';
    if (method !== 'GET') mocks.sent.push({ method, path: `${url.pathname}${url.search}`, body: init?.body ? JSON.parse(String(init.body)) : null });
    const route = mocks.routes[`${method} ${url.pathname}`];
    return route ? route(init, url) : Response.json({});
  }));
  vi.stubGlobal('open', vi.fn(() => null));
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><SeriesDetailPage /></QueryClientProvider>);
  return user;
}
const menu = () => within(screen.getByRole('menu'));
const menuLabels = () => menu().queryAllByRole('menuitem').map((item) => item.textContent?.trim()).filter(Boolean);
const rowValue = (label: string) => {
  const section = screen.getByRole('heading', { name: 'Information' }).parentElement!;
  const labelNode = within(section).getAllByText(label, { exact: true })[0];
  return labelNode.nextElementSibling?.textContent;
};

describe('series detail page (characterization)', () => {
  it('shows the series, its facts, seasons, cast and TMDB sections', async () => {
    renderPage();
    expect(await screen.findAllByRole('heading', { level: 1, name: 'Severance' })).toHaveLength(2);
    expect(screen.getByText('CONTINUING')).toBeTruthy();
    const titleLine = () => screen.getAllByRole('heading', { level: 1, name: 'Severance' }).at(-1)!.nextElementSibling?.textContent;
    await waitFor(() => expect(titleLine()).toMatch(/^2022\s*·\s*55m\s*·\s*TV-MA$/));
    expect(screen.getByText('87%')).toBeTruthy();
    expect(await screen.findByText('“Work is a mystery.”')).toBeTruthy();
    expect(screen.getByText('Apple TV+', { selector: 'span.text-sm' })).toBeTruthy();
    expect(screen.getByText('Drama, Mystery')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Dan Erickson' }).getAttribute('href')).toBe('/discover/person/1');

    // Information rows, in order.
    await waitFor(() => expect(rowValue('Show Type')).toBe('Scripted'));
    const info = screen.getByRole('heading', { name: 'Information' }).parentElement!;
    const labels = [...info.querySelectorAll('.detail-info-rows > div > span:first-child')].map((node) => node.textContent);
    expect(labels).toEqual([
      'Quality Profile', 'Series Type', 'Show Type', 'Certification', 'Runtime', 'First Aired', 'Last Aired', 'Previous Airing', 'Release Date',
      'Original Language', 'Origin Country', 'Next Episode', 'Tags', 'Path', 'Root Folder', 'New Seasons', 'Season Folders',
      'Season Count', 'Episode File Count', 'Episode Count', 'Total Episode Count', 'Size on Disk', 'Release Groups', 'Percent of Episodes', 'Added',
      'Season 0 (Specials)', 'Season 1', 'Season 2',
    ]);
    expect(rowValue('Quality Profile')).toBe('HD-1080p');
    expect(rowValue('Series Type')).toBe('Standard');
    expect(rowValue('Tags')).toBe('kids');
    expect(rowValue('Root Folder')).toBe('/tv');
    expect(rowValue('Next Episode')).toBe('S3E1 · Untitled · Nov 1, 2026');
    expect(rowValue('Percent of Episodes')).toBe('66.7%');
    expect(rowValue('Season 1')).toMatch(/^Files 2\/3 · Total 3 · Size .+ · Coverage 66\.7% · Previous Mar [23], 2024 at .+ · Groups GRP$/);
    expect(rowValue('Season 0 (Specials)')).toBe('Files 0/0 · Total 1 · Coverage 0%');

    // Seasons, newest first, with file counts, watched counts and TMDB season data.
    const seasonLinks = screen.getAllByRole('link').filter((link) => /\/series\/7\/season\/\d/.test(link.getAttribute('href') ?? ''));
    expect(seasonLinks.map((link) => link.getAttribute('href'))).toEqual([`/series/7/season/2?instance=son-1`, `/series/7/season/1?instance=son-1`]);
    expect(seasonLinks[1].textContent).toContain('Season 12/3');
    expect(seasonLinks[1].textContent).toContain('8.4');
    expect(within(seasonLinks[1]).getByTitle('2 watched')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Season 1 monitored' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Season 2 monitored' }).getAttribute('aria-pressed')).toBe('false');

    // Cast, crew and the TMDB rails.
    expect(await screen.findByText('Adam Scott (Mark Scout · 19 ep)')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cast' }).getAttribute('href')).toBe('/series/7/credits?type=cast&instance=son-1');
    expect(screen.getByText('Ben Stiller (Director)')).toBeTruthy();
    for (const name of ['Videos', 'Recommendations', 'Where to watch']) expect(screen.getByRole('region', { name })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Similar Shows' })).toBeNull();
    expect(screen.getByRole('link', { name: /Apple TV\+/ }).getAttribute('href')).toBe('/discover?networks=2552&networkName=Apple%20TV%2B&contentType=show');
    expect(screen.getByRole('link', { name: 'Red Hour' }).getAttribute('href')).toBe('/discover?companies=3&companyName=Red%20Hour&contentType=show');
  });

  it('offers each action only to someone who may take it', async () => {
    renderPage();
    await screen.findAllByRole('heading', { level: 1, name: 'Severance' });
    expect(menuLabels()).toEqual([
      'Refresh', 'Search Monitored', 'Open in Trakt', 'Open in IMDb', 'Open in TVDB', 'Open in Sonarr', 'Open in Jellyfin',
      'Add to Watchlist…', 'Schedule alert…', 'Monitor', 'Edit', 'Preview Rename', 'Manage Episodes', 'Delete',
    ]);
    expect(screen.getByRole('button', { name: 'Monitored' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Schedule alert' })).toBeTruthy();
  });

  it('is read-only for a viewer', async () => {
    mocks.caps = new Set();
    mocks.role = 'member';
    renderPage();
    await screen.findAllByRole('heading', { level: 1, name: 'Severance' });
    expect(menuLabels()).toEqual(['Open in Trakt', 'Open in IMDb', 'Open in TVDB', 'Open in Sonarr', 'Open in Jellyfin', 'Add to Watchlist…']);
    expect(screen.queryByRole('button', { name: 'Monitored' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Season 1 monitored' })).toBeNull();
    await waitFor(() => expect(rowValue('Show Type')).toBe('Scripted'));
    expect(screen.queryByText('Root Folder', { exact: true })).toBeTruthy();
  });

  it('toggles the series and a season monitored, and applies a monitoring option', async () => {
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Monitored' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Unmonitored'));
    expect(mocks.sent[0]).toEqual({ method: 'PUT', path: '/api/sonarr/7?instanceId=son-1', body: expect.objectContaining({ id: 7, monitored: false }) });

    await user.click(screen.getByRole('button', { name: 'Season 2 monitored' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Season 2 monitored'));
    const seasonPut = mocks.sent[1].body as { seasons: Array<{ seasonNumber: number; monitored: boolean }> };
    expect(seasonPut.seasons.map((s) => [s.seasonNumber, s.monitored])).toEqual([[0, false], [1, true], [2, true]]);

    await user.click(menu().getByRole('menuitem', { name: 'Monitor' }));
    const drawer = screen.getByRole('dialog');
    await user.click(within(drawer).getByRole('button', { name: 'Last Season' }));
    await user.click(within(drawer).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Monitor set to: Last Season'));
    const [command, put] = mocks.sent.slice(2);
    expect(command).toEqual({ method: 'POST', path: '/api/sonarr/command?instanceId=son-1', body: { name: 'RefreshSeries', seriesId: 7 } });
    const body = put.body as { monitored: boolean; addOptions: unknown; seasons: Array<{ seasonNumber: number; monitored: boolean }> };
    expect(body.monitored).toBe(true);
    expect(body.addOptions).toEqual({ monitor: 'lastSeason' });
    expect(body.seasons.map((s) => [s.seasonNumber, s.monitored])).toEqual([[0, false], [1, false], [2, true]]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('refreshes, searches, and deletes with the files only when asked', async () => {
    const user = renderPage();
    await screen.findAllByRole('heading', { level: 1, name: 'Severance' });
    await user.click(menu().getByRole('menuitem', { name: 'Refresh' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Refresh complete'));
    await user.click(menu().getByRole('menuitem', { name: 'Search Monitored' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Series search started'));
    expect(mocks.sent.map((sent) => sent.body)).toEqual([{ name: 'RefreshSeries', seriesId: 7 }, { name: 'SeriesSearch', seriesId: 7 }]);

    await user.click(menu().getByRole('menuitem', { name: 'Delete' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('heading', { name: 'Delete Severance?' })).toBeTruthy();
    await user.click(within(drawer).getByRole('checkbox', { name: 'Also delete all files from disk' }));
    await user.click(within(drawer).getByRole('button', { name: 'Delete Series' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/series'));
    expect(mocks.sent.at(-1)).toEqual({ method: 'DELETE', path: '/api/sonarr/7?deleteFiles=true&instanceId=son-1', body: null });
  });

  it('expands a season into its TMDB episodes, linking those Sonarr has', async () => {
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Season 1 episodes' }));
    expect(await screen.findByText(/E1 · Good News About Hell/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /E1 · Good News About Hell/ }).getAttribute('href')).toBe('/series/7/season/1/episode/101?instance=son-1');
    expect(screen.getByText(/E4 · The You You Are/).closest('a')).toBeNull();
    expect(screen.getByRole('button', { name: 'Season 1 episodes' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('opens season interactive search, rename preview, watchlist and alert dialogs', async () => {
    const user = renderPage();
    await screen.findAllByRole('heading', { level: 1, name: 'Severance' });
    await user.click(menu().getByRole('menuitem', { name: 'Preview Rename' }));
    expect(screen.getByRole('dialog', { name: 'Rename preview' })).toBeTruthy();
    await user.click(menu().getByRole('menuitem', { name: 'Schedule alert…' }));
    expect(screen.getByRole('dialog', { name: 'Schedule alert dialog' }).textContent).toContain('/series/7?instance=son-1 2022-02-18');
    await user.click(screen.getAllByRole('button', { name: 'Add to watchlist' })[0]);
    expect(screen.getByRole('dialog', { name: 'Add to watchlist dialog' })).toBeTruthy();
  });

  it("opens the header menu's Edit and Manage Episodes on their own pages", async () => {
    const user = renderPage();
    await screen.findAllByRole('heading', { level: 1, name: 'Severance' });
    await user.click(menu().getByRole('menuitem', { name: 'Edit' }));
    expect(mocks.push).toHaveBeenLastCalledWith('/series/7/edit?instance=son-1');
    await user.click(menu().getByRole('menuitem', { name: 'Manage Episodes' }));
    expect(mocks.push).toHaveBeenLastCalledWith('/series/7/manage?title=Severance&instance=son-1');
  });

  it("offers the poster's and each season's quick actions, and searches a season interactively", async () => {
    mocks.contextMenus = true;
    const user = renderPage();
    const poster = within((await screen.findAllByRole('group', { name: 'Severance actions' }))[0]);
    expect(poster.getAllByRole('button').map((action) => action.textContent)).toEqual([
      'Unmonitor', 'Monitoring options…', 'Refresh', 'Search Monitored', 'Preview Rename', 'Open in Jellyfin', 'Delete',
    ]);
    expect(poster.getAllByRole('link').map((action) => [action.textContent, action.getAttribute('href')])).toEqual([
      ['Edit', '/series/7/edit?instance=son-1'],
      ['Manage Episodes', '/series/7/manage?title=Severance&instance=son-1'],
      ['Open in IMDb', 'https://www.imdb.com/title/tt11280740'],
      ['Open in TVDB', 'https://www.thetvdb.com/?id=371980&tab=series'],
      ['Open in Sonarr', 'https://sonarr.example/series/severance'],
    ]);

    const season1 = within(screen.getByRole('group', { name: 'Season 1 actions' }));
    expect(season1.getByRole('link', { name: 'Open season' }).getAttribute('href')).toBe('/series/7/season/1?instance=son-1');
    await user.click(season1.getByRole('button', { name: 'Interactive search…' }));
    const dialog = screen.getByRole('dialog', { name: 'Interactive search' });
    expect(dialog.textContent).toContain('Severance - Season 1');
    expect(dialog.textContent).toContain('{"seriesId":7,"seasonNumber":1,"instanceId":"son-1"}');
  });

  it('says when the series is not found, cannot be loaded, or its episodes cannot', async () => {
    mocks.routes['GET /api/sonarr/7'] = () => new Response('{}', { status: 404 });
    const first = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SeriesDetailPage /></QueryClientProvider>);
    expect(await screen.findByText('Series not found')).toBeTruthy();
    first.unmount();

    mocks.routes['GET /api/sonarr/7'] = () => new Response('{}', { status: 502 });
    const second = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SeriesDetailPage /></QueryClientProvider>);
    expect(await screen.findByText("Couldn't load this series. Sonarr may be unreachable.")).toBeTruthy();
    second.unmount();

    mocks.routes['GET /api/sonarr/7'] = () => Response.json(standardSeries());
    mocks.routes['GET /api/sonarr/7/episodes'] = () => new Response('{}', { status: 502 });
    renderPage();
    expect(await screen.findByText("Couldn't load episodes for this series.")).toBeTruthy();
  });

  describe('an anime series', () => {
    const anime = () => standardSeries({ seriesType: 'anime', title: 'Frieren', tmdbId: 209867 });

    it('shows AniList detail for the mapped season, with tabs, facts and links', async () => {
      mocks.routes['GET /api/sonarr/7'] = () => Response.json(anime());
      mocks.routes['GET /api/sonarr/7/anime'] = (_init, url) => {
        if (url!.searchParams.get('detail') === '200') return Response.json({ mapping: animePayload([{ anilistMediaId: 154587, titleSnapshot: 'Frieren' }, { anilistMediaId: 200, titleSnapshot: 'Frieren Season 2' }]).mapping, detail: animeDetail(200, { title: 'Frieren Season 2', seasonYear: 2026 }) });
        return Response.json(animePayload([{ anilistMediaId: 154587, titleSnapshot: 'Frieren' }, { anilistMediaId: 200, titleSnapshot: 'Frieren Season 2' }]));
      };
      const user = renderPage();
      expect(await screen.findByRole('banner', { name: 'Anime hero' })).toBeTruthy();
      expect(screen.getByRole('banner', { name: 'Anime hero' }).textContent).toContain("Frieren: Beyond Journey's End · next in 0m");
      // No TMDB enrichment for a mapped anime.
      expect(screen.queryByText('Adam Scott (Mark Scout · 19 ep)')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Season 1 episodes' })).toBeNull();

      const facts = screen.getByRole('region', { name: 'AniList Information' });
      expect(facts.textContent).toContain('Format: TV');
      expect(facts.textContent).toContain('Country of Origin: Japan');
      expect(facts.textContent).toContain('Status: Finished');
      expect(facts.textContent).toContain('Season: Fall 2023');
      expect(facts.textContent).toContain('Source: Manga');
      expect(within(facts).getByRole('link', { name: 'Madhouse' }).getAttribute('href')).toBe('/anime/studio/11');
      expect(within(facts).getByRole('link', { name: 'Aniplex' }).getAttribute('href')).toBe('/anime/studio/12');
      expect(screen.getByText('Sousou no Frieren')).toBeTruthy();
      expect(screen.getByText('Elf')).toBeTruthy();
      expect(screen.queryByText('Twist')).toBeNull();
      expect(screen.getByRole('link', { name: /Keiichirou Saitou/ }).getAttribute('href')).toBe('/anime/staff/99');
      expect(screen.getByText('Completed')).toBeTruthy();
      expect(screen.getByRole('link', { name: 'MyAnimeList' }).getAttribute('href')).toBe('https://myanimelist.net/anime/52991');
      expect(screen.getByRole('link', { name: 'Crunchyroll' })).toBeTruthy();
      expect(screen.getByRole('button', { name: /AniList.*Auto matched · 2 seasons/ })).toBeTruthy();
      expect(menuLabels()).toEqual(expect.arrayContaining(['Open in Anime', 'Remap AniList']));
      expect(rowValue('Show Type')).toBe('TV');

      // The second season tab loads its own detail.
      await user.click(screen.getByRole('button', { name: 'Season 2' }));
      expect(await screen.findByText(/Frieren Season 2 · next in/)).toBeTruthy();
      expect(mocks.sent).toEqual([]);

      await user.click(screen.getByRole('button', { name: /AniList.*Auto matched/ }));
      expect(screen.getByRole('dialog', { name: 'Remap AniList drawer' })).toBeTruthy();
    });

    const ENTRIES = [{ anilistMediaId: 154587, titleSnapshot: 'Frieren' }, { anilistMediaId: 200, titleSnapshot: 'Frieren Season 2' }];
    const seasonTwo = (extra: Record<string, unknown> = {}) => animeDetail(200, { title: 'Frieren Season 2', ...extra });

    it('hands the remap drawer every entry, and applies what it saved', async () => {
      mocks.routes['GET /api/sonarr/7'] = () => Response.json(anime());
      mocks.routes['GET /api/sonarr/7/anime'] = (_init, url) => {
        if (url!.searchParams.get('full') === '1') return Response.json({ mapping: animePayload(ENTRIES).mapping, details: [animeDetail(154587), seasonTwo()] });
        if (url!.searchParams.get('detail') === '200') return Response.json({ mapping: animePayload(ENTRIES).mapping, detail: seasonTwo() });
        return Response.json(animePayload(ENTRIES));
      };
      const user = renderPage();
      await screen.findByRole('banner', { name: 'Anime hero' });
      await user.click(screen.getByRole('button', { name: 'Season 2' }));
      expect(await screen.findByText(/Frieren Season 2 · next in/)).toBeTruthy();

      await user.click(screen.getByRole('button', { name: /AniList.*Auto matched/ }));
      const drawer = () => within(screen.getByRole('dialog', { name: 'Remap AniList drawer' }));
      expect(await drawer().findByText('Drawer details: 154587,200')).toBeTruthy();

      // A new mapping starts over on its first season, with the drawer's set replaced.
      mocks.remapResult = {
        mapping: { state: 'MANUAL', entries: [{ anilistMediaId: 300, titleSnapshot: 'Frieren Season 3' }, { anilistMediaId: 154587, titleSnapshot: 'Frieren' }] },
        details: [animeDetail(300, { title: 'Frieren Season 3' }), animeDetail(154587)],
      };
      await user.click(drawer().getByRole('button', { name: 'Apply mapping' }));
      expect(mocks.toast.success).toHaveBeenCalledWith('AniList mapping updated');
      expect(screen.getByRole('banner', { name: 'Anime hero' }).textContent).toContain('Frieren Season 3 · next in');
      expect(drawer().getByText('Drawer details: 300,154587')).toBeTruthy();

      // Cleared: the page falls back to TMDB.
      mocks.routes['GET /api/discover/tv/209867'] = () => Response.json({ ...tmdb, seasons: [] });
      mocks.remapResult = { mapping: { state: 'MANUAL_NONE', entries: [] }, details: [] };
      await user.click(drawer().getByRole('button', { name: 'Apply mapping' }));
      expect(mocks.toast.success).toHaveBeenLastCalledWith('AniList mapping cleared');
      expect(await screen.findByText('Adam Scott (Mark Scout · 19 ep)')).toBeTruthy();
      expect(screen.queryByRole('banner', { name: 'Anime hero' })).toBeNull();
    });

    it('offers a retry when a season cannot load, and loads it on retry', async () => {
      let failing = true;
      mocks.routes['GET /api/sonarr/7'] = () => Response.json(anime());
      mocks.routes['GET /api/sonarr/7/anime'] = (_init, url) => {
        if (url!.searchParams.get('detail') === '200') return failing ? new Response('{}', { status: 502 }) : Response.json({ mapping: animePayload(ENTRIES).mapping, detail: seasonTwo() });
        return Response.json(animePayload(ENTRIES));
      };
      const user = renderPage();
      await screen.findByRole('banner', { name: 'Anime hero' });
      await user.click(screen.getByRole('button', { name: 'Season 2' }));
      const retry = await screen.findByRole('button', { name: "Couldn't load this season — tap to retry" });

      failing = false;
      await user.click(retry);
      expect(await screen.findByText(/Frieren Season 2 · next in/)).toBeTruthy();
    });

    it('refreshes the season on screen when the app is back in focus, and starts over when AniList dropped it', async () => {
      let detail: unknown = seasonTwo();
      let entries = ENTRIES;
      mocks.routes['GET /api/sonarr/7'] = () => Response.json(anime());
      mocks.routes['GET /api/sonarr/7/anime'] = (_init, url) => {
        if (url!.searchParams.get('detail') === '200') return Response.json({ mapping: animePayload(entries).mapping, detail });
        return Response.json(animePayload(entries));
      };
      const user = renderPage();
      await screen.findByRole('banner', { name: 'Anime hero' });
      await user.click(screen.getByRole('button', { name: 'Season 2' }));
      expect(await screen.findByText(/Frieren Season 2 · next in/)).toBeTruthy();

      detail = seasonTwo({ title: 'Frieren Season 2 (refreshed)' });
      act(() => { window.dispatchEvent(new Event('focus')); });
      expect(await screen.findByText(/Frieren Season 2 \(refreshed\) · next in/)).toBeTruthy();

      detail = null;
      entries = ENTRIES.slice(0, 1);
      act(() => { window.dispatchEvent(new Event('focus')); });
      expect(await screen.findByText(/Frieren: Beyond Journey's End · next in/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Season 2' })).toBeNull();
    });

    it('counts down to the next episode, minute by minute', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const airingAt = Math.floor(Date.now() / 1000) + 2 * 3600 + 30 * 60 + 30;
        mocks.routes['GET /api/sonarr/7'] = () => Response.json(anime());
        mocks.routes['GET /api/sonarr/7/anime'] = () => Response.json({
          mapping: animePayload(ENTRIES.slice(0, 1)).mapping,
          details: [animeDetail(154587, { nextAiringEpisode: { airingAt, episode: 5, timeUntilAiring: 9030 } })],
        });
        renderPage();
        expect(await screen.findByText(/· next in 2h 30m$/)).toBeTruthy();
        await act(() => vi.advanceTimersByTimeAsync(60_000));
        expect(screen.getByRole('banner', { name: 'Anime hero' }).textContent).toMatch(/· next in 2h 29m$/);
      } finally {
        vi.useRealTimers();
      }
    });

    it('falls back to TMDB when no AniList entry is mapped, and asks an admin to map it', async () => {
      mocks.routes['GET /api/sonarr/7'] = () => Response.json(anime());
      mocks.routes['GET /api/sonarr/7/anime'] = () => Response.json(animePayload([], 'AUTO_UNMATCHED'));
      mocks.routes['GET /api/discover/tv/209867'] = () => Response.json({ ...tmdb, seasons: [] });
      renderPage();
      expect(await screen.findByRole('button', { name: 'Map to AniList' })).toBeTruthy();
      expect(await screen.findByText('Adam Scott (Mark Scout · 19 ep)')).toBeTruthy();
      expect(screen.getByRole('button', { name: /AniList.*No confident match/ })).toBeTruthy();
      // Anime seasons never expand into TMDB episodes.
      expect(screen.queryByRole('button', { name: 'Season 1 episodes' })).toBeNull();
    });
  });
});
