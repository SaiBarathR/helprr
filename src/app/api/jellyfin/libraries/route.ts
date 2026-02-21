import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';

export async function GET() {
  try {
    const client = await getJellyfinClient();
    const libraries = await client.getLibraries();
    return NextResponse.json({ libraries });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch libraries';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
