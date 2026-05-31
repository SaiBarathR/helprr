import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { AniListReauthRequiredError, loadAniListConnection } from '@/lib/anilist-oauth';
import {
  fetchMediaListCollection,
  type AniListMediaListCollection,
  type AniListMediaListStatus,
  type AniListMediaType,
} from '@/lib/anilist-mutations';
import { getAnilistJsonWithCache } from '@/lib/cache/anilist-api-cache';
import { withApiLogging } from '@/lib/api-logger';

const VALID_TYPES: AniListMediaType[] = ['ANIME', 'MANGA'];
const VALID_STATUSES: AniListMediaListStatus[] = [
  'CURRENT',
  'PLANNING',
  'COMPLETED',
  'DROPPED',
  'PAUSED',
  'REPEATING',
];

async function getHandler(request: NextRequest): Promise<NextResponse> {
  // AniList is a single shared operator account — its list is admin-only.
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const conn = await loadAniListConnection();
  if (!conn || !conn.accessToken || !conn.anilistUserId) {
    return NextResponse.json(
      { error: 'AniList not connected', requiresReauth: !!conn && (!conn.accessToken || !conn.anilistUserId) },
      { status: 400 }
    );
  }

  const typeParam = request.nextUrl.searchParams.get('type');
  const statusParam = request.nextUrl.searchParams.get('status');

  const type: AniListMediaType = typeParam && (VALID_TYPES as string[]).includes(typeParam)
    ? (typeParam as AniListMediaType)
    : 'ANIME';

  const status = statusParam && (VALID_STATUSES as string[]).includes(statusParam)
    ? (statusParam as AniListMediaListStatus)
    : undefined;

  try {
    const userId = conn.anilistUserId;
    const collection = await getAnilistJsonWithCache<AniListMediaListCollection>({
      endpoint: 'mediaListCollection',
      params: { userId, type, status: status ?? null },
      policy: { ttlSeconds: 5 * 60, staleSeconds: 30 * 60 },
      fetcher: () => fetchMediaListCollection({ userId, type, status }),
    });
    return NextResponse.json({ type, status: status ?? null, collection });
  } catch (error) {
    if (error instanceof AniListReauthRequiredError) {
      return NextResponse.json(
        { error: 'AniList re-authentication required', requiresReauth: true },
        { status: 401 }
      );
    }
    console.error('AniList library fetch failed', error);
    return NextResponse.json(
      { error: 'Failed to fetch AniList library' },
      { status: 502 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/anilist/library');
