import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';

export async function GET() {
  try {
    const client = await getJellyfinClient();
    const tasks = await client.getScheduledTasks();
    return NextResponse.json({ tasks });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch scheduled tasks';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
