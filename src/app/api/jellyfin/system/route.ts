import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const client = await getJellyfinClient();
    const system = await client.getSystemInfo();
    return NextResponse.json({ system });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch system info';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
