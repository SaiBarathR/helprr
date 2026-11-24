import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { toProxySummaries } from '@/lib/prowlarr-proxies';

/** Prowlarr's indexer proxies (FlareSolverr, HTTP, SOCKS) and the indexers each one serves. */
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('prowlarr.view');
  if (!auth.ok) return auth.response;

  try {
    const client = await getProwlarrClient();
    const [proxies, indexers] = await Promise.all([client.getIndexerProxies(), client.getIndexers()]);
    return NextResponse.json(toProxySummaries(proxies, indexers));
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch indexer proxies');
  }
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/indexerproxies');
