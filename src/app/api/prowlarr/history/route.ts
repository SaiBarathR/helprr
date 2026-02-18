import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') ?? '50', 10);
    const indexerIdParam = searchParams.get('indexerId');
    const indexerId = indexerIdParam ? parseInt(indexerIdParam, 10) : undefined;
    const eventTypeParam = searchParams.get('eventType');
    const eventType = eventTypeParam !== null ? parseInt(eventTypeParam, 10) : undefined;
    const successfulParam = searchParams.get('successful');
    const successful = successfulParam !== null ? successfulParam === 'true' : undefined;

    const client = await getProwlarrClient();
    const history = await client.getHistory({ page, pageSize, indexerId, eventType, successful });
    return NextResponse.json(history);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch history';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
