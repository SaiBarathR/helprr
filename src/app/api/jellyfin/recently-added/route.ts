import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = searchParams.get('limit');
    const parsedLimit = rawLimit ? Number(rawLimit) : Number.NaN;
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(Math.floor(parsedLimit), 100))
      : 20;
    const client = await getJellyfinClient();
    const items = await client.getRecentlyAdded({ limit });
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch recently added';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
