import { NextRequest, NextResponse } from 'next/server';
import { createSession, verifyPassword, COOKIE_NAME, SESSION_DURATION } from '@/lib/auth';
import { getRedisClient } from '@/lib/redis';

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_WINDOW_SECONDS = Math.max(1, Math.ceil(LOGIN_WINDOW_MS / 1000));
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_ATTEMPTS_KEY_PREFIX = 'login:attempts:';

function formatWindowDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  if (totalSeconds % 60 === 0) {
    const minutes = totalSeconds / 60;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
}

const LOGIN_WINDOW_TEXT = formatWindowDuration(LOGIN_WINDOW_MS);

function getClientIp(request: NextRequest): string | null {
  // Only trust x-forwarded-for when traffic passes through a sanitized reverse proxy.
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const [firstIp] = forwardedFor.split(',');
    const trimmed = firstIp?.trim();
    if (trimmed) return trimmed;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  return realIp || null;
}

function attemptsKey(ip: string): string {
  return `${LOGIN_ATTEMPTS_KEY_PREFIX}${ip}`;
}

async function incrementAttempts(ip: string): Promise<number> {
  const redis = await getRedisClient();
  const key = attemptsKey(ip);
  const result = await redis.eval(
    `local attempts = redis.call('INCR', KEYS[1])
if attempts == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return attempts`,
    {
      keys: [key],
      arguments: [String(LOGIN_WINDOW_MS)],
    }
  );

  const attempts = Number(result);
  if (!Number.isFinite(attempts)) {
    throw new Error('Unexpected Redis result for login attempts');
  }

  return attempts;
}

async function clearAttempts(ip: string): Promise<void> {
  const redis = await getRedisClient();
  await redis.del(attemptsKey(ip));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(request);
  const rateLimitKey = ip ?? 'unknown';

  let attempts: number;
  try {
    attempts = await incrementAttempts(rateLimitKey);
  } catch {
    return NextResponse.json({ error: 'Login service unavailable' }, { status: 503 });
  }

  if (attempts > LOGIN_MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: `Too many login attempts. Try again in ${LOGIN_WINDOW_TEXT}.` },
      {
        status: 429,
        headers: { 'Retry-After': String(LOGIN_WINDOW_SECONDS) },
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const password = (body as { password?: unknown })?.password;

  if (typeof password !== 'string') {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 });
  }

  if (!verifyPassword(password)) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  try {
    await clearAttempts(rateLimitKey);
  } catch (error) {
    console.error('[Auth] Failed to clear login attempts:', error);
  }

  const token = await createSession();

  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DURATION,
    path: '/',
  });

  return response;
}
