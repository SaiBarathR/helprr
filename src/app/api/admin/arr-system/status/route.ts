import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { NO_STORE, readSystemStatus, resolveSystemTarget } from '@/lib/server/arr-system';

// One Sonarr/Radarr/Lidarr/Prowlarr instance's version, and whether it offers
// an update. Read-only: Helprr never installs one. Admins only, like
// Helprr's own update check.
async function getHandler(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const resolved = await resolveSystemTarget(request.nextUrl.searchParams.get('instanceId'));
    if (!resolved.ok) return resolved.response;
    return NextResponse.json(await readSystemStatus(resolved.target.client), { headers: NO_STORE });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch version');
  }
}

export const GET = withApiLogging(getHandler, 'api/admin/arr-system/status');
