import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

const ID_PATTERN = /^[0-9a-fA-F-]{8,40}$/;
const MAX_LIMIT = 200;

// Every Jellyfin query param is allowlisted and re-built server-side — the
// browser never gets to pass arbitrary params through to Jellyfin.
const SORT_BY = new Set(['SortName', 'DateCreated', 'PremiereDate', 'CommunityRating', 'Random']);
const SORT_ORDER = new Set(['Ascending', 'Descending']);
const ITEM_TYPES = new Set(['Movie', 'Series', 'MusicAlbum', 'BoxSet']);
const FILTERS = new Set(['IsPlayed', 'IsUnplayed', 'IsFavorite']);

// Paged, user-scoped item listing for the library browser grid.
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  const sp = request.nextUrl.searchParams;

  const parentId = sp.get('parentId');
  if (!parentId || !ID_PATTERN.test(parentId)) {
    return NextResponse.json({ error: 'Valid parentId is required' }, { status: 400 });
  }

  const startIndexRaw = Number.parseInt(sp.get('startIndex') ?? '0', 10);
  const limitRaw = Number.parseInt(sp.get('limit') ?? '100', 10);
  const startIndex = Number.isFinite(startIndexRaw) ? Math.max(startIndexRaw, 0) : 0;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT) : 100;

  const sortBy = sp.get('sortBy') ?? 'SortName';
  const sortOrder = sp.get('sortOrder') ?? 'Ascending';
  if (!SORT_BY.has(sortBy) || !SORT_ORDER.has(sortOrder)) {
    return NextResponse.json({ error: 'Invalid sort' }, { status: 400 });
  }

  const includeItemTypes = sp.get('includeItemTypes');
  if (includeItemTypes !== null && !ITEM_TYPES.has(includeItemTypes)) {
    return NextResponse.json({ error: 'Invalid includeItemTypes' }, { status: 400 });
  }

  const filter = sp.get('filter');
  if (filter !== null && !FILTERS.has(filter)) {
    return NextResponse.json({ error: 'Invalid filter' }, { status: 400 });
  }

  const searchTerm = sp.get('search')?.trim().slice(0, 100);

  try {
    const client = await getJellyfinClientForUser(auth.user);
    const data = await client.getItems({
      ParentId: parentId,
      // Typed libraries (movies/tvshows/music) need a recursive query to skip
      // folder nesting; untyped views are listed shallow as-is.
      Recursive: includeItemTypes !== null,
      ...(includeItemTypes !== null ? { IncludeItemTypes: includeItemTypes } : {}),
      ...(filter !== null ? { Filters: filter } : {}),
      ...(searchTerm ? { SearchTerm: searchTerm } : {}),
      SortBy: sortBy,
      SortOrder: sortOrder,
      StartIndex: startIndex,
      Limit: limit,
      Fields: 'ProductionYear,UserData,ChildCount',
      EnableImageTypes: 'Primary',
      ImageTypeLimit: 1,
    });
    return NextResponse.json({
      items: data.Items,
      total: data.TotalRecordCount,
      linked: true,
    });
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({ items: [], total: 0, linked: false });
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch items';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/items');
