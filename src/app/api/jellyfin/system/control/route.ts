import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function postHandler(req: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const capError = await requireCapability('jellyfin.control');
  if (capError) return capError;

  try {
    const { action } = (await req.json()) as { action: string };
    const client = await getJellyfinClient();

    switch (action) {
      case 'restart':
        await client.restartServer();
        break;
      case 'shutdown':
        await client.shutdownServer();
        break;
      case 'scan-libraries':
        await client.scanAllLibraries();
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to execute action');
  }
}

export const POST = withApiLogging(postHandler, 'api/jellyfin/system/control');
