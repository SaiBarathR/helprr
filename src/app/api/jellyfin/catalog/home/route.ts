import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinUserContext, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { CATALOG_LIST_FIELDS } from '@/types/jellyfin-streaming';
import type { CatalogHomeResponse } from '@/types/jellyfin-streaming';

import { cachedJellyfinCatalog } from '@/lib/cache/jellyfin-catalog';

const EMPTY_HOME: CatalogHomeResponse = {
  linked: false,
  views: [],
  spotlight: [],
  resume: [],
  nextUp: [],
  latest: [],
  favorites: [],
  upcoming: [],
  suggestions: [],
};

function recommendationTitle(row: { BaselineItemName?: string; RecommendationType?: string }): string {
  if (row.BaselineItemName) return `Because you watched ${row.BaselineItemName}`;
  const type = (row.RecommendationType || '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return type || 'Suggested for you';
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const section = params.get('section') ?? 'all';
  if (!['all', 'core', 'latest', 'favorites', 'upcoming', 'suggestions'].includes(section)) {
    return NextResponse.json({ error: 'Invalid section' }, { status: 400 });
  }
  try {
    const { client, connectionFingerprint, jellyfinUserId } = await getJellyfinUserContext(auth.user);
    const identity = `${connectionFingerprint}:${jellyfinUserId}`;
    const read = <T,>(key: string, load: () => Promise<T>) => cachedJellyfinCatalog(auth.user.id, identity, key, load);
    const payload: CatalogHomeResponse = { ...EMPTY_HOME, latest: [], linked: true };
    const views = () => read('views', () => client.getLibraries());
    if (section === 'all' || section === 'core') {
      const [libraries, resume, nextUp, spotlight] = await Promise.all([
        views(),
        read('resume', () => client.getResumeItems({ limit: 24, extraFields: CATALOG_LIST_FIELDS })),
        read('nextUp', () => client.getNextUp({ limit: 24 })),
        read('spotlight', () => client.getCatalogItems({ Recursive: true, IncludeItemTypes: 'Movie,Series', Limit: 24, SortBy: 'Random', Fields: `${CATALOG_LIST_FIELDS},Taglines` })).catch(() => ({ Items: [] })),
      ]);
      payload.views = libraries;
      payload.resume = resume.Items ?? [];
      payload.nextUp = nextUp.Items ?? [];
      payload.spotlight = (spotlight.Items ?? []).filter((item) => (item.BackdropImageTags?.length ?? 0) > 0 && Boolean(item.Overview)).slice(0, 5);
    }
    if (section === 'all' || section === 'latest') {
      const libraries = (payload.views.length ? payload.views : await views()).filter((view) => !['playlists', 'boxsets'].includes((view.CollectionType || '').toLowerCase())).slice(0, 12);
      const wanted = params.get('libraryId');
      const selected = wanted ? libraries.filter((view) => view.Id === wanted) : libraries;
      if (wanted && !selected.length) return NextResponse.json({ error: 'Library unavailable' }, { status: 404 });
      // Legacy callers retain the complete contract, with bounded fan-out.
      for (let offset = 0; offset < selected.length; offset += 3) {
        const batch = await Promise.all(selected.slice(offset, offset + 3).map(async (view) => ({
          libraryId: view.Id, libraryName: view.Name, collectionType: view.CollectionType || '',
          items: await read(`latest:${view.Id}`, () => client.getRecentlyAdded({ limit: 16, parentId: view.Id })),
        })));
        payload.latest.push(...batch.filter((row) => row.items.length));
      }
    }
    if (section === 'all' || section === 'favorites') {
      payload.favorites = (await read('favorites', () => client.getCatalogItems({ Filters: 'IsFavorite', Recursive: true, Limit: 24, SortBy: 'DatePlayed,SortName', SortOrder: 'Descending', IncludeItemTypes: 'Movie,Series,Episode,Audio,MusicAlbum,MusicArtist,Book,Video' }))).Items ?? [];
    }
    if (section === 'all' || section === 'upcoming') payload.upcoming = (await read('upcoming', () => client.getUpcoming(24))).Items ?? [];
    if (section === 'all' || section === 'suggestions') payload.suggestions = (await read('suggestions', () => client.getMovieRecommendations())).map((row) => ({ title: recommendationTitle(row), items: row.Items ?? [] })).filter((row) => row.items.length);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) return NextResponse.json(EMPTY_HOME);
    return upstreamErrorResponse(error, 'Failed to load Jellyfin home section');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/catalog/home');
