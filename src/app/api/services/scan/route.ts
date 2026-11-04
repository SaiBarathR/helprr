import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { scanForApps } from '@/lib/app-scan';

// Admin only: looks for the usual apps on a fixed list of addresses (src/lib/app-scan.ts).
// A POST, so nothing (a prefetch, a crawler) starts a scan by just opening a link.
async function postHandler(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  return NextResponse.json({ found: await scanForApps() }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const POST = withApiLogging(postHandler, 'api/services/scan');
