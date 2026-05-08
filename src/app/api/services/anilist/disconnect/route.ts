import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { deleteAniListConnection } from '@/lib/anilist-oauth';

export async function POST(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  await deleteAniListConnection();
  return NextResponse.json({ ok: true });
}
