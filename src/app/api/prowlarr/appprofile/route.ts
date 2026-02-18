import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';

export async function GET() {
  try {
    const client = await getProwlarrClient();
    const profiles = await client.getAppProfiles();
    return NextResponse.json(profiles);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch app profiles';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
