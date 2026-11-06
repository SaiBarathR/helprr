// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canManage: true,
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: mocks.push }) }));
vi.mock('@/components/permission-provider', () => ({
  useCan: (cap: string) => cap !== 'activity.manage' || mocks.canManage,
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
// The sheet's content renders only for a selected event, so a pass-through drawer shows it inline.
vi.mock('@/components/ui/drawer', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Drawer: Pass, DrawerContent: Pass, DrawerHeader: Pass, DrawerTitle: Pass };
});

import { HistoryEventDrawer, type HistoryRecord } from '../history-event';

const REASON = 'Download failed: the download client reported an unpack error';

const sonarrEvent = (extra: Partial<HistoryRecord> = {}): HistoryRecord => ({
  id: 1,
  sourceTitle: 'Severance.S02E01.1080p.WEB-DL',
  eventType: 'downloadFailed',
  date: new Date().toISOString(),
  quality: { quality: { name: 'WEBDL-1080p' } },
  qualityCutoffNotMet: false,
  data: { message: REASON },
  source: 'sonarr',
  instanceId: 'son-1',
  seriesId: 5,
  episodeId: 301,
  series: { id: 5, title: 'Severance' } as HistoryRecord['series'],
  episode: { id: 301, seasonNumber: 2, episodeNumber: 1, title: 'Hello, Ms. Cobel' } as HistoryRecord['episode'],
  ...extra,
});

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  void url; void init;
  return Response.json({ id: 9 });
});

beforeEach(() => {
  mocks.canManage = true;
  mocks.push.mockClear();
  mocks.toast.success.mockClear();
  mocks.toast.error.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const renderSheet = (item: HistoryRecord) => render(<HistoryEventDrawer item={item} onClose={() => {}} />);

describe('history event sheet: failed downloads', () => {
  it('leads with why the download failed', () => {
    renderSheet(sonarrEvent());
    expect(screen.getByText('Why it failed')).toBeTruthy();
    expect(screen.getByText(REASON)).toBeTruthy();
  });

  it('shows no failure callout or recovery actions for a grabbed event', () => {
    renderSheet(sonarrEvent({ eventType: 'grabbed', data: { message: REASON, indexer: 'Nyaa' } }));
    expect(screen.queryByText('Why it failed')).toBeNull();
    expect(screen.queryByText(REASON)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Interactive search' })).toBeNull();
  });

  it('Search again sends the Retry command to the event\'s instance and confirms it', async () => {
    renderSheet(sonarrEvent());
    await userEvent.click(screen.getByRole('button', { name: 'Search again' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sonarr/command?instanceId=son-1');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'EpisodeSearch', episodeIds: [301] });
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
  });

  it('searches a failed Radarr movie with MoviesSearch', async () => {
    renderSheet(sonarrEvent({
      source: 'radarr', instanceId: 'rad 2', seriesId: undefined, episodeId: undefined, series: undefined, episode: undefined,
      movieId: 11, movie: { id: 11, title: 'Inception', year: 2010 } as HistoryRecord['movie'],
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Search again' }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/radarr/command?instanceId=rad%202');
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'MoviesSearch', movieIds: [11] });
  });

  it('searches a failed Lidarr album with AlbumSearch', async () => {
    renderSheet(sonarrEvent({
      source: 'lidarr', instanceId: 'lid-1', seriesId: undefined, episodeId: undefined, series: undefined, episode: undefined,
      albumId: 31, album: { id: 31, title: 'First Album' } as HistoryRecord['album'],
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Search again' }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/lidarr/command?instanceId=lid-1');
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'AlbumSearch', albumIds: [31] });
  });

  it('offers no search for a Lidarr import that is still waiting for a manual import', () => {
    renderSheet(sonarrEvent({
      source: 'lidarr', eventType: 'albumImportIncomplete', data: { statusMessages: '[]' },
      seriesId: undefined, episodeId: undefined, series: undefined, episode: undefined,
      albumId: 31, album: { id: 31, title: 'First Album' } as HistoryRecord['album'],
    }));
    expect(screen.queryByText('Why it failed')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search again' })).toBeNull();
  });

  it('disables Search again while it runs and reports a failure', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => { resolve = r; }));
    renderSheet(sonarrEvent());
    const button = screen.getByRole('button', { name: 'Search again' }) as HTMLButtonElement;

    await userEvent.click(button);
    expect(button.disabled).toBe(true);
    resolve(Response.json({ error: 'Sonarr is unreachable' }, { status: 502 }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  });

  it('opens the episode\'s interactive search on the same instance', async () => {
    renderSheet(sonarrEvent());
    await userEvent.click(screen.getByRole('button', { name: 'Interactive search' }));
    expect(mocks.push).toHaveBeenCalledWith(
      '/series/5/season/2/episode/301/search?title=Severance+-+S02E01+-+Hello%2C+Ms.+Cobel&instance=son-1',
    );
  });

  it('hides the search actions from a member without activity.manage, but keeps the reason and the link', () => {
    mocks.canManage = false;
    renderSheet(sonarrEvent());
    expect(screen.getByText(REASON)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Search again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Interactive search' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open episode' }).getAttribute('href'))
      .toBe('/series/5/season/2/episode/301?instance=son-1');
  });
});
