import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { deleteAniListConnection } from '@/lib/anilist-oauth';
import { withApiLogging } from '@/lib/api-logger';

async function postHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.instances');
  if (!auth.ok) return auth.response;

  await deleteAniListConnection();
  return NextResponse.json({ ok: true });
}

export const POST = withApiLogging(postHandler, 'api/services/anilist/disconnect');
