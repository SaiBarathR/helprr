import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { checkForUpdates } from '@/lib/update-check';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getHandler(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION || 'unknown';
  const result = await checkForUpdates(currentVersion);
  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export const GET = withApiLogging(getHandler, 'api/admin/update-check', { logBodies: false });
