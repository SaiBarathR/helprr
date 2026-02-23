import { NextRequest, NextResponse } from 'next/server';
import { createSession, verifyPassword, COOKIE_NAME, SESSION_DURATION } from '@/lib/auth';

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 5;
const CLEANUP_INTERVAL_MS = LOGIN_WINDOW_MS * 5;
const loginAttemptsByIp = new Map<string, number[]>();

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const [firstIp] = forwardedFor.split(',');
    if (firstIp) return firstIp.trim();
  }
  return request.headers.get('x-real-ip') || 'unknown';
}

function pruneOldAttempts(attempts: number[], now: number): number[] {
  return attempts.filter((timestamp) => now - timestamp < LOGIN_WINDOW_MS);
}

function getRecentAttempts(ip: string, now: number): number[] {
  const attempts = loginAttemptsByIp.get(ip) || [];
  const recentAttempts = pruneOldAttempts(attempts, now);
  loginAttemptsByIp.set(ip, recentAttempts);
  return recentAttempts;
}

function cleanupStaleAttempts(now: number): void {
  for (const [ip, attempts] of loginAttemptsByIp.entries()) {
    const recentAttempts = pruneOldAttempts(attempts, now);
    if (recentAttempts.length === 0) {
      loginAttemptsByIp.delete(ip);
    } else {
      loginAttemptsByIp.set(ip, recentAttempts);
    }
  }
}

const cleanupTimer = setInterval(() => {
  cleanupStaleAttempts(Date.now());
}, CLEANUP_INTERVAL_MS);

if (typeof cleanupTimer === 'object' && cleanupTimer && 'unref' in cleanupTimer && typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { password } = body as { password?: string };
  const ip = getClientIp(request);
  const now = Date.now();

  if (getRecentAttempts(ip, now).length >= LOGIN_MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: 'Too many login attempts. Try again in 1 minute.' },
      { status: 429 }
    );
  }

  if (typeof password !== 'string') {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 });
  }

  if (!verifyPassword(password)) {
    const recentAttempts = getRecentAttempts(ip, now);
    loginAttemptsByIp.set(ip, [...recentAttempts, now]);
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  loginAttemptsByIp.delete(ip);

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
