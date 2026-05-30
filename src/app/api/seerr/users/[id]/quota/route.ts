import { NextRequest, NextResponse } from 'next/server';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!can(auth.user, 'requests.view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id: raw } = await params;
    if (!/^\d+$/.test(raw)) {
      return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
    }
    const requestedId = Number.parseInt(raw, 10);
    if (!Number.isFinite(requestedId) || requestedId <= 0) {
      return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
    }
    // Non-admins can only read their own quota; admins may read anyone's.
    let id = requestedId;
    if (auth.user.role !== 'admin') {
      const own = auth.user.seerrUserId ? Number.parseInt(auth.user.seerrUserId, 10) : NaN;
      if (!Number.isInteger(own)) {
        return NextResponse.json({ error: 'Not linked', linked: false }, { status: 404 });
      }
      id = own;
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
