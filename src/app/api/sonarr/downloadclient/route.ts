import { NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';

export async function GET() {
  try {
    const client = await getSonarrClient();
    const clients = await client.getDownloadClients();
    return NextResponse.json(clients);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch download clients';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
