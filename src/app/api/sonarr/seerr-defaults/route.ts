import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getSeerrAddDefaults } from '@/lib/seerr-add-defaults';

// The add page's starting profile and folder: Seerr's default for this instance, when
// Seerr sends requests to it. Only ids and a path leave the server, never Seerr's keys.
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('series.add');
  if (!auth.ok) return auth.response;
  const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
  return NextResponse.json(await getSeerrAddDefaults('sonarr', instanceId), { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiLogging(getHandler, 'api/sonarr/seerr-defaults');
