import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireUserAnyCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { REFERENCE_CACHE_HEADERS } from '@/lib/cache/reference-headers';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  // Also Manual grab's quality and language pickers (interactive search, activity.manage).
  const auth = await requireUserAnyCapability(['movies.manageFiles', 'activity.manage']);
  if (!auth.ok) return auth.response;

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const languages = await client.getLanguages();
    return NextResponse.json(languages, { headers: REFERENCE_CACHE_HEADERS });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch languages');
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/languages');
