import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireCapability } from '@/lib/auth';
import {
  getActiveCacheUsage,
  getCacheMaintenanceMeta,
  purgeActiveCache,
  purgeAnilistCache,
} from '@/lib/cache/admin';
import { getCacheImagesEnabled } from '@/lib/cache/state';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler() {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('settings.storage');
  if (capError) return capError;

  try {
    const [enabled, usage, maintenance] = await Promise.all([
      getCacheImagesEnabled({ forceRefresh: true }),
      getActiveCacheUsage(),
      getCacheMaintenanceMeta(),
    ]);

    return NextResponse.json({
      enabled,
      usage,
      status: maintenance.status,
      lastPurgedAt: maintenance.lastPurgedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch cache usage';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function deleteHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('settings.storage');
  if (capError) return capError;

  try {
    // ?provider=anilist clears only AniList API keys (images/TMDB untouched).
    const provider = new URL(request.url).searchParams.get('provider');
    if (provider === 'anilist') {
      const result = await purgeAnilistCache();
      const usage = await getActiveCacheUsage();
      return NextResponse.json({
        purged: true,
        provider: 'anilist',
        deletedEntries: result.deletedEntries,
        deletedBytes: result.deletedBytes,
        usage,
      });
    }
    if (provider !== null) {
      return NextResponse.json({ error: 'Unknown cache provider' }, { status: 400 });
    }

    const result = await purgeActiveCache();
    const usage = await getActiveCacheUsage();

    return NextResponse.json({
      purged: true,
      result,
      usage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to purge cache';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/settings/cache');
export const DELETE = withApiLogging(deleteHandler, 'api/settings/cache');
