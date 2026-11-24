import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

/**
 * Sync one app now. Prowlarr's sync command has no per-app form, so the server
 * saves the app unchanged, which makes Prowlarr test it and add and update that
 * app's indexers (removals wait for Sync All). The browser never handles the
 * app's settings, and a failure is a fixed message: Prowlarr's can quote the
 * arr's URL.
 */
async function postHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('prowlarr.manage');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!/^\d{1,10}$/.test(id) || Number(id) === 0) {
    return NextResponse.json({ error: 'Invalid application id' }, { status: 400 });
  }

  try {
    const client = await getProwlarrClient();
    const application = await client.getApplication(Number(id));
    // Prowlarr saves a sync-off app without syncing it, which would look like a sync that worked.
    if (application.syncLevel === 'disabled') {
      return NextResponse.json({ error: 'Sync is off for this app' }, { status: 409 });
    }
    await client.resaveApplication(application);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Sync failed');
  }
}

export const POST = withApiLogging(postHandler, 'api/prowlarr/applications/[id]/sync');
