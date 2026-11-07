import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { can } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';
import { keepLeavingSoonItem } from '@/lib/library-cleanup/service';
import { upstreamErrorResponse } from '@/lib/api-error';

// Who may keep a title: anyone who may view that library. Unknown types fail closed.
const KEEP_VIEW_CAPABILITY: Record<string, Capability> = { movie: 'movies.view', series: 'series.view' };

// "Keep": adds the keep tag in Sonarr/Radarr (audited) and takes the title off Leaving soon.
async function postHandler(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!/^[a-z0-9]{1,64}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const item = await prisma.leavingSoonItem.findUnique({ where: { id } });
  const viewCap = item ? KEEP_VIEW_CAPABILITY[item.mediaType] : undefined;
  // A title the caller may not view is reported as missing, never confirmed.
  if (!item || !viewCap || !can(auth.user, viewCap)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    await keepLeavingSoonItem(item, { id: auth.user.id, username: auth.user.username });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Could not set the keep tag');
  }
}

export const POST = withApiLogging(postHandler, 'api/leaving-soon/[id]/keep');
