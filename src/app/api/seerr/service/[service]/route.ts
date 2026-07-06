import { NextRequest, NextResponse } from 'next/server';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

// Quality profiles / root folders / tags for the request + approve modals.
async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ service: string }> }
): Promise<NextResponse> {
  const auth = await requireUserCapability('requests.create');
  if (!auth.ok) return auth.response;

  const { service } = await params;
  if (service !== 'radarr' && service !== 'sonarr') {
    return NextResponse.json({ error: 'Invalid service' }, { status: 400 });
  }
  const is4k = request.nextUrl.searchParams.get('is4k') === 'true';

  try {
    const client = await getSeerrClient();
    const data = await client.getServiceData(service, is4k);
    return NextResponse.json(data);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to load service options');
  }
}

export const GET = withApiLogging(getHandler, 'api/seerr/service/[service]');
