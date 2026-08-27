import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import type { CatalogBrowseKind, CatalogBrowseResponse } from '@/types/jellyfin-streaming';

const KINDS: Record<CatalogBrowseKind, 'Genres' | 'Studios' | 'Persons'> = {
  genres: 'Genres',
  studios: 'Studios',
  persons: 'Persons',
};

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get('kind') ?? '';
  if (!Object.hasOwn(KINDS, kind)) {
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  }

  try {
    const client = await getJellyfinClientForUser(auth.user);
    const data = await client.getBrowseEntities(KINDS[kind as CatalogBrowseKind], {
      parentId: searchParams.get('parentId') ?? undefined,
      searchTerm: searchParams.get('searchTerm') ?? undefined,
      startIndex: clampInt(searchParams.get('startIndex'), 0, 0, 100_000),
      limit: clampInt(searchParams.get('limit'), 100, 1, 200),
    });
    return NextResponse.json({
      linked: true,
      kind: kind as CatalogBrowseKind,
      items: data.Items ?? [],
      total: data.TotalRecordCount ?? 0,
    } satisfies CatalogBrowseResponse);
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({
        linked: false,
        kind: kind as CatalogBrowseKind,
        items: [],
        total: 0,
      } satisfies CatalogBrowseResponse);
    }
    return upstreamErrorResponse(error, 'Failed to browse Jellyfin library');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/catalog/browse');
