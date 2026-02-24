import { NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const client = await getSonarrClient();
    const series = await client.getSeries();
    return NextResponse.json(series);
  } catch (error) {
    console.error('Failed to fetch series:', error);
    return NextResponse.json({ error: 'Failed to fetch series' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const client = await getSonarrClient();
    const result = await client.addSeries(body);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to add series:', error);
    return NextResponse.json({ error: 'Failed to add series' }, { status: 500 });
  }
}
