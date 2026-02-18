import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';

export async function POST() {
  try {
    const client = await getProwlarrClient();
    const result = await client.testAllIndexers();
    return NextResponse.json(result ?? { success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Test All failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
