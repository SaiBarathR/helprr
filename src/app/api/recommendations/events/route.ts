import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { ingestEvents, parseEventsBody } from '@/lib/recommendations/events';

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('recommendations.view');
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = parseEventsBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Events are always attributed to the authenticated user — there is no
  // client-supplied user id to validate, by design.
  const result = await ingestEvents(auth.user.id, parsed.events);
  if (!result.ok) {
    return NextResponse.json({ error: 'Too many events, slow down' }, { status: 429 });
  }
  return NextResponse.json({ stored: result.stored });
}

export const POST = withApiLogging(postHandler, 'api/recommendations/events');
