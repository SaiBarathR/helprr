import { NextRequest, NextResponse } from 'next/server';
import { createSession, verifyPassword, COOKIE_NAME, SESSION_DURATION } from '@/lib/auth';
import { getRedisClient } from '@/lib/redis';

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_ATTEMPTS_KEY_PREFIX = 'login:attempts:';

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
  const attempts = await redis.incr(key);

  if (attempts === 1) {
    await redis.pExpire(key, LOGIN_WINDOW_MS);
  }

  return attempts;
}

async function clearAttempts(ip: string): Promise<void> {
  const redis = await getRedisClient();
  await redis.del(attemptsKey(ip));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(request);
  if (!ip) {
    return NextResponse.json({ error: 'Unable to determine client IP' }, { status: 400 });
  }

  let attempts: number;
  try {
    attempts = await incrementAttempts(ip);
  } catch {
    return NextResponse.json({ error: 'Login service unavailable' }, { status: 503 });
  }

  if (attempts > LOGIN_MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: 'Too many login attempts. Try again in 1 minute.' },
      { status: 429 }
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
    await clearAttempts(ip);
  } catch {
    return NextResponse.json({ error: 'Login service unavailable' }, { status: 503 });
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
