import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

/**
 * Handle GET requests to fetch Radarr download clients.
 *
 * @returns A JSON HTTP response containing the array of download clients on success; on failure a JSON `{ error }` — 404 when the upstream returned 404, otherwise 500 with a generic message.
 */
async function getHandler(request: NextRequest) {
  // Only the interactive-release flow consumes this, which is activity.manage-gated.
  const auth = await requireUserCapability('activity.manage');
  if (!auth.ok) return auth.response;

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const clients = await client.getDownloadClients();
    return NextResponse.json(clients);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch download clients');
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/downloadclient');
