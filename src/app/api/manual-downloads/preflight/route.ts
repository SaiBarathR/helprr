import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { preflightManualDownload } from '@/lib/manual-downloads';
import { withApiLogging } from '@/lib/api-logger';

async function postHandler(request: NextRequest) {
  const auth = await requireUserCapability('torrents.add');
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || (body.service !== 'SONARR' && body.service !== 'RADARR') || body.mode !== 'ARR_MANAGED' || typeof body.magnetUrl !== 'string') {
    return NextResponse.json({ error: 'Invalid preflight request' }, { status: 400 });
  }
  const addCap = body.service === 'SONARR' ? 'series.add' : 'movies.add';
  if (!can(auth.user, addCap) || !can(auth.user, 'activity.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await preflightManualDownload({
      mode: body.mode,
      service: body.service,
      instanceId: typeof body.instanceId === 'string' ? body.instanceId : '',
      media: body.media && typeof body.media === 'object' ? body.media as Record<string, unknown> : {},
      magnetUrl: typeof body.magnetUrl === 'string' ? body.magnetUrl : undefined,
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Preflight failed' }, { status: 400 });
  }
}

export const POST = withApiLogging(postHandler, 'api/manual-downloads/preflight');
