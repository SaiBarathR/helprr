import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { buildSupportBundle, serializeSupportBundle } from '@/lib/support-bundle';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getHandler(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const bundle = await buildSupportBundle();
  const stamp = bundle.generatedAt.replace(/[:.]/g, '-');
  return new NextResponse(serializeSupportBundle(bundle), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="helprr-support-${stamp}.json"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const GET = withApiLogging(getHandler, 'api/admin/support-bundle', { logBodies: false });
