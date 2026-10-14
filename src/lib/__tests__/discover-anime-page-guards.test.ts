import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string; role: string; template: string; permissions: Record<string, boolean> },
}));

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(async () => mocks.user),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
// The client home pages are not rendered here, only the server guard around them.
vi.mock('@/app/(app)/discover/discover-home', () => ({ default: () => null }));
vi.mock('@/app/(app)/anime/anime-home', () => ({ default: () => null }));

import DiscoverLayout from '@/app/(app)/discover/layout';
import DiscoverPage from '@/app/(app)/discover/page';
import AnimeLayout from '@/app/(app)/anime/layout';
import AnimePage from '@/app/(app)/anime/page';
import AnimeScheduleLayout from '@/app/(app)/anime/schedule/layout';
import AnimeExploreLayout from '@/app/(app)/anime/explore/layout';
import { getAllWidgetDefinitions } from '@/lib/widgets/registry';
import { hasCapabilities } from '@/components/permission-provider';

function member(permissions: Record<string, boolean>) {
  return { id: 'member-1', role: 'member', template: 'member', permissions };
}

const children = null;

async function outcome(render: () => Promise<unknown>) {
  try {
    await render();
    return 'renders';
  } catch (error) {
    if (error instanceof Error && error.message === 'NEXT_NOT_FOUND') return 'notFound';
    throw error;
  }
}

beforeEach(() => {
  mocks.user = null;
});

describe('Discover page guards', () => {
  it('keeps title pages open to a member reaching them from Movies, Series, Watchlist or Recommendations', async () => {
    for (const cap of ['movies.view', 'series.view', 'watchlist.view', 'recommendations.view']) {
      mocks.user = member({
        'discover.view': false, 'movies.view': false, 'series.view': false,
        'watchlist.view': false, 'recommendations.view': false, [cap]: true,
      });
      expect(await outcome(() => DiscoverLayout({ children })), cap).toBe('renders');
      // The Discover home page itself still needs discover.view.
      expect(await outcome(() => DiscoverPage()), cap).toBe('notFound');
    }
  });

  it('denies every Discover page to a member with none of those capabilities', async () => {
    mocks.user = member({
      'discover.view': false, 'movies.view': false, 'series.view': false,
      'watchlist.view': false, 'recommendations.view': false,
    });
    expect(await outcome(() => DiscoverLayout({ children }))).toBe('notFound');
  });

  it('opens the Discover home page with discover.view, and to admins', async () => {
    mocks.user = member({});
    expect(await outcome(() => DiscoverPage())).toBe('renders');
    mocks.user = { id: 'admin-1', role: 'admin', template: 'admin', permissions: { 'discover.view': false } };
    expect(await outcome(() => DiscoverPage())).toBe('renders');
  });

  it('denies a request with no user', async () => {
    expect(await outcome(() => DiscoverLayout({ children }))).toBe('notFound');
    expect(await outcome(() => DiscoverPage())).toBe('notFound');
  });
});

describe('Anime page guards', () => {
  it('keeps detail pages open from Series, Watchlist and Recommendations, but not Anime home, schedule or explore', async () => {
    for (const cap of ['series.view', 'watchlist.view', 'recommendations.view']) {
      mocks.user = member({
        'anime.view': false, 'series.view': false, 'watchlist.view': false,
        'recommendations.view': false, [cap]: true,
      });
      expect(await outcome(() => AnimeLayout({ children })), cap).toBe('renders');
      expect(await outcome(() => AnimePage()), cap).toBe('notFound');
      expect(await outcome(() => AnimeScheduleLayout({ children })), cap).toBe('notFound');
      expect(await outcome(() => AnimeExploreLayout({ children })), cap).toBe('notFound');
    }
  });

  it('opens every Anime page with anime.view', async () => {
    mocks.user = member({ 'series.view': false, 'watchlist.view': false, 'recommendations.view': false });
    for (const render of [
      () => AnimeLayout({ children }), () => AnimePage(),
      () => AnimeScheduleLayout({ children }), () => AnimeExploreLayout({ children }),
    ]) {
      expect(await outcome(render)).toBe('renders');
    }
  });

  it('denies every Anime page to a member with none of the capabilities', async () => {
    mocks.user = member({
      'anime.view': false, 'series.view': false, 'watchlist.view': false, 'recommendations.view': false,
    });
    expect(await outcome(() => AnimeLayout({ children }))).toBe('notFound');
  });
});

describe('dashboard widgets backed by gated routes', () => {
  const defs = getAllWidgetDefinitions({
    sections: [{ id: 'trending', label: 'Trending', enabled: true }],
  } as never);
  const byId = new Map(defs.map((def) => [def.id, def]));

  it('require the capability of the route each one fetches', () => {
    expect(byId.get('for-you')?.requiredCapability).toBe('recommendations.view');
    expect(byId.get('discover-trending')?.requiredCapability).toBe('discover.view');
    const animeCarousels = defs.filter((def) => def.id.startsWith('anime-'));
    expect(animeCarousels.length).toBeGreaterThan(0);
    for (const def of animeCarousels) expect(def.requiredCapability, def.id).toBe('anime.view');
  });

  it('are hidden from a member without the capability, as the dashboard and gallery filter them', () => {
    const me = { role: 'member', capabilities: { 'anime.view': false, 'recommendations.view': true } } as never;
    expect(hasCapabilities(me, byId.get('anime-trending')!.requiredCapability!)).toBe(false);
    expect(hasCapabilities(me, byId.get('for-you')!.requiredCapability!)).toBe(true);
  });
});
