import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getJwtSecret } from '@/lib/jwt-secret';
import { prisma } from '@/lib/db';

const SESSION_DURATION = 30 * 24 * 60 * 60; // 30 days in seconds
const COOKIE_NAME = 'helprr-session';
const LAST_SEEN_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

const lastSeenTouched = new Map<string, number>();

interface SessionRow {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  userAgent: string | null;
  ip: string | null;
  label: string | null;
  revokedAt: Date | null;
}

export interface CreateSessionInput {
  userAgent?: string | null;
  ip?: string | null;
}

export async function createSession(input: CreateSessionInput = {}): Promise<string> {
  const session = await prisma.session.create({
    data: {
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
    },
    select: { id: true },
  });

  const token = await new SignJWT({ authenticated: true, sid: session.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION}s`)
    .sign(getJwtSecret());

  return token;
}

interface DecodedToken {
  sid: string | null;
}

async function decodeToken(token: string): Promise<DecodedToken | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ['HS256'] });
    const sid = typeof payload.sid === 'string' ? payload.sid : null;
    return { sid };
  } catch {
    return null;
  }
}

async function loadAndTouchSession(sid: string): Promise<SessionRow | null> {
  const session = await prisma.session.findUnique({ where: { id: sid } });
  if (!session || session.revokedAt) return null;

  const now = Date.now();
  const last = lastSeenTouched.get(sid) ?? session.lastSeenAt.getTime();
  if (now - last > LAST_SEEN_DEBOUNCE_MS) {
    lastSeenTouched.set(sid, now);
    prisma.session
      .update({ where: { id: sid }, data: { lastSeenAt: new Date(now) } })
      .catch((err) => {
        console.error('[Auth] Failed to touch session lastSeenAt:', err);
      });
  }

  return session;
}

async function readToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

export async function verifySession(token: string): Promise<boolean> {
  const decoded = await decodeToken(token);
  if (!decoded || !decoded.sid) return false;
  const session = await loadAndTouchSession(decoded.sid);
  return session !== null;
}

export async function getCurrentSid(): Promise<string | null> {
  const token = await readToken();
  if (!token) return null;
  const decoded = await decodeToken(token);
  return decoded?.sid ?? null;
}

export async function getCurrentSession(): Promise<SessionRow | null> {
  const token = await readToken();
  if (!token) return null;
  const decoded = await decodeToken(token);
  if (!decoded || !decoded.sid) return null;
  return loadAndTouchSession(decoded.sid);
}

export async function getSession(): Promise<boolean> {
  return (await getCurrentSession()) !== null;
}

export async function requireAuth(): Promise<NextResponse | null> {
  const token = await readToken();
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const decoded = await decodeToken(token);
  if (!decoded || !decoded.sid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const session = await loadAndTouchSession(decoded.sid);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export async function requireSession(): Promise<
  { ok: true; session: SessionRow } | { ok: false; response: NextResponse }
> {
  const token = await readToken();
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const decoded = await decodeToken(token);
  if (!decoded || !decoded.sid) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const session = await loadAndTouchSession(decoded.sid);
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { ok: true, session };
}

export async function revokeSession(sid: string): Promise<void> {
  lastSeenTouched.delete(sid);
  await prisma.session.update({
    where: { id: sid },
    data: { revokedAt: new Date() },
  });
}

export function verifyPassword(password: string): boolean {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) return false;
  const passwordBuffer = Buffer.from(password);
  const appPasswordBuffer = Buffer.from(appPassword);
  if (passwordBuffer.length !== appPasswordBuffer.length) return false;
  return timingSafeEqual(passwordBuffer, appPasswordBuffer);
}

export { COOKIE_NAME, SESSION_DURATION };
