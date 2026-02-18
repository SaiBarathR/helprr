import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = await getProwlarrClient();
    const result = await client.testIndexer(parseInt(id, 10));
    return NextResponse.json(result ?? { success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Test failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
