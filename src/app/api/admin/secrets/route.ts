import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { secretsStatus } from '@/lib/generated-secrets';

// Admin only: where the session secret and push keys came from. Never the values.
async function getHandler(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  return NextResponse.json(secretsStatus(), { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiLogging(getHandler, 'api/admin/secrets');
