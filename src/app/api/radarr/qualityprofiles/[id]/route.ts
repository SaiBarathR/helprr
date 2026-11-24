import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { qualityProfileResponse } from '@/lib/quality-profile-summary';

// The read-only quality profile sheet on the detail pages.
async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('movies.view');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
  return qualityProfileResponse('RADARR', instanceId, id);
}

export const GET = withApiLogging(getHandler, 'api/radarr/qualityprofiles/[id]');
