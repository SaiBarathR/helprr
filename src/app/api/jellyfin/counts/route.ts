import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function GET(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const client = await getJellyfinClient();
    const counts = await client.getItemCounts();
    return NextResponse.json({ counts });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch item counts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
