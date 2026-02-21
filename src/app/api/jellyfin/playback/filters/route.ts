import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';

export async function GET() {
  try {
    const client = await getJellyfinClient();
    const filters = await client.getTypeFilterList();
    return NextResponse.json({ filters: filters ?? [], pluginAvailable: filters !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch type filters';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
