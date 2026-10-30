import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

/** Prowlarr's tags, so indexers can show names instead of ids. */
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('prowlarr.view');
  if (!auth.ok) return auth.response;

  try {
    const client = await getProwlarrClient();
    const tags = await client.getTags();
    return NextResponse.json(tags.map(({ id, label }) => ({ id, label })));
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch tags');
  }
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/tags');
