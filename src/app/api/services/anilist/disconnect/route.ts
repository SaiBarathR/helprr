import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { deleteAniListConnection } from '@/lib/anilist-oauth';
import { withApiLogging } from '@/lib/api-logger';
import { recordSecurityEvent } from '@/lib/security-audit';

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.instances');
  if (!auth.ok) return auth.response;

  if (await deleteAniListConnection()) {
    await recordSecurityEvent(request, {
      actor: auth.user,
      action: 'SERVICE_DELETED',
      targetType: 'service',
      targetLabel: 'AniList',
    });
  }
  return NextResponse.json({ ok: true });
}

export const POST = withApiLogging(postHandler, 'api/services/anilist/disconnect');
