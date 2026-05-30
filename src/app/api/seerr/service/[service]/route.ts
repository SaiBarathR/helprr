import { NextRequest, NextResponse } from 'next/server';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';

// Quality profiles / root folders / tags for the request + approve modals.
async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ service: string }> }
): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!can(auth.user, 'requests.create')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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
    const message = error instanceof Error ? error.message : 'Failed to load service options';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/seerr/service/[service]');
