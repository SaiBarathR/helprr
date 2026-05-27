import { NextResponse } from 'next/server';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const client = await getSeerrClient();
    const counts = await client.getRequestCount();
    return NextResponse.json(counts);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch request counts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/seerr/requests/count');
