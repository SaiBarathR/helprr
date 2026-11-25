import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { NO_STORE, resolveSystemTarget, toBackups } from '@/lib/server/arr-system';

// One instance's System → Backup list: each backup's id, name, type, size and
// time, never its path. Back up now is the Backup task (POST ../tasks); the
// file, restore and delete are under ./[id] and ask for the admin's password.
async function getHandler(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const resolved = await resolveSystemTarget(request.nextUrl.searchParams.get('instanceId'));
    if (!resolved.ok) return resolved.response;
    return NextResponse.json(toBackups(await resolved.target.client.systemAdmin.getBackups()), { headers: NO_STORE });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch backups');
  }
}

export const GET = withApiLogging(getHandler, 'api/admin/arr-system/backups');
