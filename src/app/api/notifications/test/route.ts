import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { notifyEvent } from '@/lib/notification-service';
import { withApiLogging } from '@/lib/api-logger';
import { getRedisClient } from '@/lib/redis';

const TEST_WINDOW_MS = 60_000;
const TEST_MAX_ATTEMPTS = 10;
const TEST_ATTEMPTS_KEY_PREFIX = 'notification-test:attempts:';

function getClientIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const [firstIp] = forwardedFor.split(',');
    const trimmed = firstIp?.trim();
    if (trimmed) return trimmed;
  }
  return request.headers.get('x-real-ip')?.trim() || null;
}

async function incrementAttempts(ip: string): Promise<number> {
  const redis = await getRedisClient();
  const result = await redis.eval(
    `local attempts = redis.call('INCR', KEYS[1])
if attempts == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return attempts`,
    {
      keys: [`${TEST_ATTEMPTS_KEY_PREFIX}${ip}`],
      arguments: [String(TEST_WINDOW_MS)],
    }
  );
  const attempts = Number(result);
  if (!Number.isFinite(attempts)) throw new Error('Unexpected Redis result for test attempts');
  return attempts;
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const rateLimitKey = getClientIp(request) ?? 'unknown';
  let attempts: number;
  try {
    attempts = await incrementAttempts(rateLimitKey);
  } catch {
    return NextResponse.json({ error: 'Rate limiter unavailable' }, { status: 503 });
  }
  if (attempts > TEST_MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: 'Too many test notifications. Wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(TEST_WINDOW_MS / 1000)) } }
    );
  }

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
