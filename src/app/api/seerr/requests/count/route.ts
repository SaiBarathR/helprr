import { NextResponse } from 'next/server';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { logger } from '@/lib/logger';

async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  // Aggregate request counts are an admin/approver dashboard metric.
  const capError = await requireCapability('requests.approve');
  if (capError) return capError;

  try {
    const client = await getSeerrClient();
    const counts = await client.getRequestCount();
    return NextResponse.json(counts);
  } catch (error) {
    logger.error(
      'Seerr request count failed',
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { error },
      { scope: 'api/seerr/requests/count' }
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/seerr/requests/count');
