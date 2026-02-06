import { NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';

export async function GET() {
  try {
    const client = await getSonarrClient();
    const profiles = await client.getQualityProfiles();
    return NextResponse.json(profiles);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch quality profiles';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
