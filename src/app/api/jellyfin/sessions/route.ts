import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const client = await getJellyfinClient();
    const sessions = await client.getActiveSessions();
    return NextResponse.json({ sessions });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch sessions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
