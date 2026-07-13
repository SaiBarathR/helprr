import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createManualDownloadMapping } from '@/lib/manual-downloads';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';

async function getHandler() {
  const auth = await requireUserCapability('torrents.view');
  if (!auth.ok) return auth.response;
  return NextResponse.json(await prisma.manualDownloadMapping.findMany({
    orderBy: { createdAt: 'desc' }, take: 100,
    include: {
      instance: { select: { label: true, type: true } },
      attempts: { orderBy: { startedAt: 'desc' }, take: 20 },
    },
  }));
}

async function postHandler(request: NextRequest) {
  const auth = await requireUserCapability('torrents.add');
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || (body.service !== 'SONARR' && body.service !== 'RADARR')) {
    return NextResponse.json({ error: 'Invalid mapping request' }, { status: 400 });
  }
  const required = body.service === 'SONARR' ? ['series.add', 'series.manageFiles'] as const : ['movies.add', 'movies.manageFiles'] as const;
  if (body.mode !== 'ARR_MANAGED' || typeof body.magnetUrl !== 'string') {
    return NextResponse.json({ error: 'Arr-managed linking is available only for magnet URLs' }, { status: 400 });
  }
  const mode = 'ARR_MANAGED' as const;
  const modeCaps = [required[0]];
  if (!modeCaps.every((cap) => can(auth.user, cap)) || !can(auth.user, 'activity.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const mapping = await createManualDownloadMapping({
      mode,
      torrentName: typeof body.torrentName === 'string' ? body.torrentName : undefined,
      magnetUrl: typeof body.magnetUrl === 'string' ? body.magnetUrl : undefined,
      service: body.service,
      instanceId: typeof body.instanceId === 'string' ? body.instanceId : '',
      media: body.media && typeof body.media === 'object' ? body.media as Record<string, unknown> : {},
      createdByUserId: auth.user.id,
    });
    return NextResponse.json(mapping, { status: 201 });
  } catch (error) {
    const typed = error as Error & { code?: string; existingId?: number };
    return NextResponse.json({ error: typed.message, existingId: typed.existingId }, { status: typed.code === 'MEDIA_EXISTS' ? 409 : 400 });
  }
}

export const GET = withApiLogging(getHandler, 'api/manual-downloads');
export const POST = withApiLogging(postHandler, 'api/manual-downloads');
