import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getActiveLayoutCached } from '@/lib/cache/dashboard-layout-cache';
import { seedInitialLayouts } from '@/lib/dashboard-layouts';

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const device = request.nextUrl.searchParams.get('device');
  if (device !== 'desktop' && device !== 'mobile') {
    return NextResponse.json({ error: "device must be 'desktop' or 'mobile'" }, { status: 400 });
  }

  try {
    await seedInitialLayouts();
    const layout = await getActiveLayoutCached(device);
    return NextResponse.json(layout);
  } catch (error) {
    console.error('Failed to fetch active dashboard layout:', error);
    return NextResponse.json({ error: 'Failed to fetch active dashboard layout' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/dashboard-layouts/active');
