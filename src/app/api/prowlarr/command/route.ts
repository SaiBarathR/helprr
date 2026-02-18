import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: 'Command name is required' }, { status: 400 });
    }

    const client = await getProwlarrClient();
    const result = await client.sendCommand(name);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send command';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
