// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ search: new URLSearchParams(), replace: vi.fn(), entries: [] as unknown[] }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.search,
  usePathname: () => '/anime/library',
}));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => (queryKey[1] === 'viewer'
    ? { data: { configured: true, connected: true, requiresReauth: false, user: { id: 1, name: 'Tester', avatar: null, siteUrl: null, scoreFormat: null } } }
    : { data: { collection: { lists: [{ entries: mocks.entries }] } }, isPending: false, isFetching: false, isError: false }),
}));
vi.mock('@/components/anime/anilist-status-drawer', () => ({ AnilistStatusDrawer: () => null }));

import { getListViewState, setListViewState } from '@/lib/media-list-cache';
import AnimeLibraryPage from './page';

const SHARED_KEY = 'anime-library:_shared';

class IntersectionObserverStub {
  observe() {}
  disconnect() {}
}

let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
  vi.stubGlobal('scrollTo', vi.fn());
  window.sessionStorage.clear();
  mocks.replace.mockClear();
  mocks.entries = [];
  setListViewState(SHARED_KEY, { scrollY: 0, search: '', extras: { type: 'ANIME', status: 'COMPLETED' } });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function open(query: string) {
  mocks.search = new URLSearchParams(query);
  window.history.replaceState(null, '', query ? `/anime/library?${query}` : '/anime/library');
  await act(async () => root.render(<AnimeLibraryPage />));
}

const activeTab = () => [...document.querySelectorAll('button')]
  .find((el) => el.className.includes('bg-primary') && el.textContent !== 'Anime')?.textContent;
const rememberedStatus = () => (getListViewState(SHARED_KEY)?.extras as { status?: string }).status;

describe('Anime Library tabs', () => {
  it('opens a ?status= link on that tab without replacing the remembered one', async () => {
    await open('status=CURRENT');

    expect(activeTab()).toBe('Watching');
    expect(rememberedStatus()).toBe('COMPLETED');
  });

  it('remembers a tab the user picks', async () => {
    await open('status=CURRENT');
    const planning = [...document.querySelectorAll('button')].find((el) => el.textContent === 'Planning');
    await act(async () => planning?.click());

    expect(activeTab()).toBe('Planning');
    expect(rememberedStatus()).toBe('PLANNING');
  });

  it('remembers a tap on the tab a link opened', async () => {
    await open('status=CURRENT');
    const watching = [...document.querySelectorAll('button')].find((el) => el.textContent === 'Watching');
    await act(async () => watching?.click());

    expect(rememberedStatus()).toBe('CURRENT');
  });

  it('resumes the remembered tab on a plain visit', async () => {
    await open('');

    expect(activeTab()).toBe('Completed');
  });

  it('leaves a URL that already shows the tab alone', async () => {
    await open('status=CURRENT');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('puts a picked tab in the URL once, and not again after the URL catches up', async () => {
    await open('status=CURRENT');
    const planning = [...document.querySelectorAll('button')].find((el) => el.textContent === 'Planning');
    await act(async () => planning?.click());
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith('/anime/library?status=PLANNING', { scroll: false });

    // The router writes the URL; later renders find it current.
    window.history.replaceState(null, '', '/anime/library?status=PLANNING');
    await open('status=PLANNING');
    expect(mocks.replace).toHaveBeenCalledTimes(1);
  });

  it('follows Back to another tab without writing the URL', async () => {
    await open('status=PLANNING');
    await open('status=CURRENT');

    expect(activeTab()).toBe('Watching');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("restores each tab's own count of shown entries when the user switches to it", async () => {
    mocks.entries = Array.from({ length: 70 }, (_, i) => ({
      id: i + 1, mediaId: 1000 + i, status: 'COMPLETED', score: 0, progress: 0,
      media: { id: 1000 + i, title: { romaji: `Show ${i}`, english: null, native: null, userPreferred: `Show ${i}` }, coverImage: { large: null }, format: 'TV', episodes: 12 },
    }));
    setListViewState('anime-library:ANIME:COMPLETED', { scrollY: 0, search: '', extras: { renderedCount: 60 } });
    const shown = () => document.querySelectorAll('a[href^="/anime/1"]').length;

    await open('');
    expect(shown()).toBe(60);

    // A tab with nothing saved starts from one page.
    const watching = [...document.querySelectorAll('button')].find((el) => el.textContent === 'Watching')!;
    await act(async () => watching.click());
    expect(shown()).toBe(30);
  });
});
