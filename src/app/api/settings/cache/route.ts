import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  getActiveCacheUsage,
  getCacheMaintenanceMeta,
  purgeActiveCache,
} from '@/lib/cache/admin';
import { getCacheImagesEnabled } from '@/lib/cache/state';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

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

export async function DELETE() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
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
