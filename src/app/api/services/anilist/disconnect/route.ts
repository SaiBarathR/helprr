import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { deleteAniListConnection } from '@/lib/anilist-oauth';
import { withApiLogging } from '@/lib/api-logger';

async function postHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  await deleteAniListConnection();
  return NextResponse.json({ ok: true });
}

export const POST = withApiLogging(postHandler, 'api/services/anilist/disconnect');
