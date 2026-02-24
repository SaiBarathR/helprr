import { NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const client = await getRadarrClient();
    const profiles = await client.getQualityProfiles();
    return NextResponse.json(profiles);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch quality profiles';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
