import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import type { CatalogItemsResponse } from '@/types/jellyfin-streaming';

const SORT_FIELDS = new Set([
  'SortName',
  'DateCreated',
  'PremiereDate',
  'ProductionYear',
  'CommunityRating',
  'CriticRating',
  'Runtime',
  'DatePlayed',
  'PlayCount',
  'Random',
  'ParentIndexNumber',
  'IndexNumber',
  'Album',
  'AlbumArtist',
  'Artist',
  'StartDate',
]);

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const parentId = searchParams.get('parentId') ?? undefined;
    const includeItemTypes = searchParams.get('includeItemTypes') ?? undefined;
    const filters = searchParams.get('filters') ?? undefined;
    const searchTerm = searchParams.get('searchTerm') ?? undefined;
    const genres = searchParams.get('genres') ?? undefined;
    const years = searchParams.get('years') ?? undefined;
    const officialRatings = searchParams.get('officialRatings') ?? undefined;
    const recursive = searchParams.get('recursive') !== 'false';
    const startIndex = clampInt(searchParams.get('startIndex'), 0, 0, 100_000);
    const limit = clampInt(searchParams.get('limit'), 50, 1, 200);
    const sortByRaw = searchParams.get('sortBy') ?? 'SortName';
    const sortBy = sortByRaw
      .split(',')
      .map((field) => field.trim())
      .filter((field) => SORT_FIELDS.has(field))
      .join(',') || 'SortName';
    const sortOrder = searchParams.get('sortOrder') === 'Descending' ? 'Descending' : 'Ascending';
    const artistIds = searchParams.get('artistIds') ?? undefined;
    const personIds = searchParams.get('personIds') ?? undefined;
    const genreIds = searchParams.get('genreIds') ?? undefined;
    const studioIds = searchParams.get('studioIds') ?? undefined;
    const ids = searchParams.get('ids') ?? undefined;
    const mediaTypes = searchParams.get('mediaTypes') ?? undefined;
    const tags = searchParams.get('tags') ?? undefined;
    const artistType = searchParams.get('artistType') ?? undefined;

    const client = await getJellyfinClientForUser(auth.user);
    const data = await client.getCatalogItems({
      StartIndex: startIndex,
      Limit: limit,
      Recursive: recursive,
      SortBy: sortBy,
      SortOrder: sortOrder,
      EnableUserData: true,
      ...(parentId ? { ParentId: parentId } : {}),
      ...(includeItemTypes ? { IncludeItemTypes: includeItemTypes } : {}),
      ...(filters ? { Filters: filters } : {}),
      ...(searchTerm ? { SearchTerm: searchTerm } : {}),
      ...(genres ? { Genres: genres } : {}),
      ...(years ? { Years: years } : {}),
      ...(officialRatings ? { OfficialRatings: officialRatings } : {}),
      ...(artistIds ? { ArtistIds: artistIds } : {}),
      ...(personIds ? { PersonIds: personIds } : {}),
      ...(genreIds ? { GenreIds: genreIds } : {}),
      ...(studioIds ? { StudioIds: studioIds } : {}),
      ...(ids ? { Ids: ids } : {}),
      ...(mediaTypes ? { MediaTypes: mediaTypes } : {}),
      ...(tags ? { Tags: tags } : {}),
      ...(artistType ? { ArtistType: artistType } : {}),
    });

    const payload: CatalogItemsResponse = {
      linked: true,
      items: data.Items ?? [],
      total: data.TotalRecordCount ?? 0,
      startIndex: data.StartIndex ?? startIndex,
    };
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({ linked: false, items: [], total: 0, startIndex: 0 } satisfies CatalogItemsResponse);
    }
    return upstreamErrorResponse(error, 'Failed to list Jellyfin items');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/catalog/items');
