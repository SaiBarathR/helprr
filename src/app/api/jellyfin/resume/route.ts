import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') ?? '10', 10);
    const client = await getJellyfinClient();
    const data = await client.getResumeItems({ limit });
    return NextResponse.json({ items: data.Items });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch resume items';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
