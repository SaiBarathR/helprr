import { NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';

export async function GET() {
  try {
    const client = await getSonarrClient();
    const series = await client.getSeries();
    return NextResponse.json(series);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch series';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const client = await getSonarrClient();
    const result = await client.addSeries(body);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to add series';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
