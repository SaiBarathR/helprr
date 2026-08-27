import { NextResponse } from 'next/server';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { CATALOG_LIST_FIELDS } from '@/types/jellyfin-streaming';
import type { CatalogHomeResponse } from '@/types/jellyfin-streaming';

const EMPTY_HOME: CatalogHomeResponse = {
  linked: false,
  views: [],
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

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  try {
    const client = await getJellyfinClientForUser(auth.user);
    const [views, resume, nextUp, favorites, upcoming, recommendations] = await Promise.all([
      client.getLibraries(),
      client.getResumeItems({ limit: 24, extraFields: CATALOG_LIST_FIELDS }),
      client.getNextUp({ limit: 24 }),
      client.getCatalogItems({
        Filters: 'IsFavorite',
        Recursive: true,
        Limit: 24,
        SortBy: 'DatePlayed,SortName',
        SortOrder: 'Descending',
        IncludeItemTypes: 'Movie,Series,Episode,Audio,MusicAlbum,MusicArtist,Book,Video',
      }),
      client.getUpcoming(24).catch(() => ({ Items: [] })),
      client.getMovieRecommendations().catch(() => []),
    ]);

    const videoViews = views.filter((view) => {
      const type = (view.CollectionType || '').toLowerCase();
      return type !== 'playlists' && type !== 'boxsets';
    });

    const latest = await Promise.all(
      videoViews.slice(0, 12).map(async (view) => {
        const items = await client.getRecentlyAdded({ limit: 16, parentId: view.Id });
        return {
          libraryId: view.Id,
          libraryName: view.Name,
          collectionType: view.CollectionType || '',
          items,
        };
      }),
    );

    const payload: CatalogHomeResponse = {
      linked: true,
      views,
      resume: resume.Items ?? [],
      nextUp: nextUp.Items ?? [],
      latest: latest.filter((row) => row.items.length > 0),
      favorites: favorites.Items ?? [],
      upcoming: upcoming.Items ?? [],
      suggestions: recommendations
        .map((row) => ({
          title: recommendationTitle(row),
          items: row.Items ?? [],
        }))
        .filter((row) => row.items.length > 0),
    };
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json(EMPTY_HOME);
    }
    return upstreamErrorResponse(error, 'Failed to load Jellyfin home');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/catalog/home');
