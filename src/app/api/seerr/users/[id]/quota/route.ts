import { NextRequest, NextResponse } from 'next/server';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id: raw } = await params;
    const id = Number.parseInt(raw, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
    }
    const client = await getSeerrClient();
    const data = await client.getUserQuota(id);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch user quota';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/seerr/users/[id]/quota');
