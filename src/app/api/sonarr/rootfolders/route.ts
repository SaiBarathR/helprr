import { NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';

export async function GET() {
  try {
    const client = await getSonarrClient();
    const folders = await client.getRootFolders();
    return NextResponse.json(folders);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch root folders';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
