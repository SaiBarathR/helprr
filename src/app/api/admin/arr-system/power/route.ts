import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { isArrPowerAction } from '@/lib/arr-system';
import { NO_STORE, recordSystemAction, resolveSystemTarget } from '@/lib/server/arr-system';

// Restart or shut down one Sonarr/Radarr/Lidarr/Prowlarr instance, as its
// System → Status does. Admins only; the sheet confirms first, and says that
// a shutdown can't be undone from Helprr (the app has to be started where it
// runs). Recorded in the security audit.
async function postHandler(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body: unknown = await request.json().catch(() => null);
    const action = body && typeof body === 'object' ? (body as { action?: unknown }).action : undefined;
    if (!isArrPowerAction(action)) {
      return NextResponse.json({ error: 'action must be restart or shutdown' }, { status: 400 });
    }
    const resolved = await resolveSystemTarget(request.nextUrl.searchParams.get('instanceId'));
    if (!resolved.ok) return resolved.response;
    const { target } = resolved;
    await target.client.systemAdmin.power(action);
    logger.info(action === 'restart' ? 'App restart sent' : 'App shutdown sent', {
      userId: auth.user.id,
      username: auth.user.username,
      instanceId: target.instanceId,
    }, { scope: target.type.toLowerCase() });
    await recordSystemAction(request, auth.user, target, action === 'restart' ? 'restarted' : 'shut down');
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return upstreamErrorResponse(error, 'The app did not accept it');
  }
}

export const POST = withApiLogging(postHandler, 'api/admin/arr-system/power');
