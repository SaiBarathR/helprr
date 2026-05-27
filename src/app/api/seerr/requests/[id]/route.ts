import { NextRequest, NextResponse } from 'next/server';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

function parseId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function getHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id: raw } = await params;
    const id = parseId(raw);
    if (id === null) return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });
    const client = await getSeerrClient();
    const data = await client.getRequest(id);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch request';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function deleteHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id: raw } = await params;
    const id = parseId(raw);
    if (id === null) return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });
    const client = await getSeerrClient();
    await client.deleteRequest(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete request';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/seerr/requests/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/seerr/requests/[id]');
