import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { configuredAppOrigin } from '@/lib/request-utils';
import { deliverToChannel } from '@/lib/notification-channels/dispatch';

type RouteContext = { params: Promise<{ id: string }> };

const TEST_WINDOW_MS = 60_000;
const TEST_MAX_ATTEMPTS = 10;
// Per user and per process, which is enough to stop a held-down button
// hammering someone's server; the push test keeps its own Redis limit.
const attempts = new Map<string, { count: number; resetAt: number }>();

function overLimit(userId: string, now = Date.now()): boolean {
  const entry = attempts.get(userId);
  if (!entry || entry.resetAt <= now) {
    attempts.set(userId, { count: 1, resetAt: now + TEST_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > TEST_MAX_ATTEMPTS;
}

/** Send a test to one of the caller's channels, ignoring its backoff, and say how it went. */
async function postHandler(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.notifications');
  if (!auth.ok) return auth.response;
  const { id } = await params;

  if (overLimit(auth.user.id)) {
    return NextResponse.json(
      { error: 'Too many tests. Wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': String(TEST_WINDOW_MS / 1000) } },
    );
  }

  try {
    const channel = await prisma.notificationChannel.findFirst({ where: { id, userId: auth.user.id } });
    if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const now = new Date();
    const origin = configuredAppOrigin();
    const result = await deliverToChannel(channel, {
      eventType: 'test',
      title: 'Helprr test notification',
      body: `Test sent at ${now.toLocaleTimeString()}`,
      link: origin ? `${origin}/notifications` : null,
      path: '/notifications',
      metadata: { source: 'test' },
      sentAt: now.toISOString(),
    }, { allowPrivate: auth.user.role === 'admin' });
    return NextResponse.json(result.ok ? { ok: true } : { ok: false, error: result.reason });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed');
  }
}

export const POST = withApiLogging(postHandler, 'api/notifications/channels/[id]/test', { logBodies: false });
