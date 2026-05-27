import { NextRequest, NextResponse } from 'next/server';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function postHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id: raw } = await params;
    const id = Number.parseInt(raw, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });
    }
    const client = await getSeerrClient();
    const data = await client.approveRequest(id);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to approve request';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withApiLogging(postHandler, 'api/seerr/requests/[id]/approve');
