import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { notifyEvent } from '@/lib/notification-service';
import { withApiLogging } from '@/lib/api-logger';

async function postHandler(_request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const now = new Date();
    const sent = await notifyEvent({
      eventType: 'test',
      title: 'Helprr Test Notification',
      body: `Test sent at ${now.toLocaleTimeString()}`,
      // include a unique id so the per-item tag (eventType-id) is different
      // for every press — otherwise rapid presses collapse into one banner
      metadata: { source: 'test', id: now.getTime() },
      url: '/notifications',
    });
    return NextResponse.json({ sent });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(postHandler, 'api/notifications/test');
