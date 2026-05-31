import { cache } from 'react';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import type { User, UserRole } from '@prisma/client';
import { getJwtSecret } from '@/lib/jwt-secret';
import { prisma } from '@/lib/db';
import { verifyPasswordHash } from '@/lib/password';
import { can } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';

const SESSION_DURATION = 30 * 24 * 60 * 60; // 30 days in seconds
const COOKIE_NAME = 'helprr-session';
const LAST_SEEN_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

// In-process debounce. In a multi-replica deployment (PM2 cluster, k8s) every
// process keeps its own map, so the DB write rate scales with replica count.
// Helprr is single-instance today; if that ever changes, move this to Redis.
const lastSeenTouched = new Map<string, number>();

interface SessionRow {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  userAgent: string | null;
  ip: string | null;
  label: string | null;
  revokedAt: Date | null;
  userId: string | null;
  user: User | null;
}

export interface CreateSessionInput {
  userId: string;
  role: UserRole;
  userAgent?: string | null;
  ip?: string | null;
}

export async function createSession(input: CreateSessionInput): Promise<string> {
  const session = await prisma.session.create({
    data: {
      userId: input.userId,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
    },
    select: { id: true },
  });

  // uid/role are carried as non-authoritative hints; every server-side check
  // re-loads the User row (loadAndTouchSession) so a role/status change takes
  // effect on the next request rather than waiting for the 30-day token to age out.
  const token = await new SignJWT({
    authenticated: true,
    sid: session.id,
    uid: input.userId,
    role: input.role,
  })
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

// Memoized per request (React cache): requireAuth + requireCapability (and any
// other guard) on the same request share a single session+user load instead of
// each issuing its own findUnique + JWT verify. Scoped to one request, so it
// never leaks a session across requests.
const loadAndTouchSession = cache(async (sid: string): Promise<SessionRow | null> => {
  const session = await prisma.session.findUnique({
    where: { id: sid },
    include: { user: true },
  });
  if (!session || session.revokedAt) return null;

  // A disabled (or pending) user is bounced on their very next request without
  // having to revoke each of their sessions individually — same enforcement
  // point as revokedAt. Sessions with no linked user (shouldn't occur after the
  // 0015 backfill) stay valid so a botched upgrade never locks the operator out.
  if (session.user && session.user.status !== 'active') return null;

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
});

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

/** Resolve the User behind the current request's session, or null if unauthenticated. */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getCurrentSession();
  return session?.user ?? null;
}

export type RequireUserResult =
  | { ok: true; user: User; session: SessionRow }
  | { ok: false; response: NextResponse };

/**
 * Like requireSession, but also resolves the owning User. Use this on routes
 * that need to know *who* is acting (per-user scoping, capability checks).
 */
export async function requireUser(): Promise<RequireUserResult> {
  const session = await getCurrentSession();
  if (!session || !session.user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { ok: true, user: session.user, session };
}

export type RequireAdminResult = RequireUserResult;

/** requireUser + role===admin. 403s authenticated non-admins. */
export async function requireAdmin(): Promise<RequireAdminResult> {
  const result = await requireUser();
  if (!result.ok) return result;
  if (result.user.role !== 'admin') {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return result;
}

/**
 * Verify a plaintext password against a user's stored hash. Returns false for
 * Jellyfin-only accounts (passwordHash === null) — local login is impossible
 * for them, but "Sign in with Jellyfin" still works.
 */
export async function verifyUserPassword(
  user: Pick<User, 'passwordHash'>,
  plain: string
): Promise<boolean> {
  if (!user.passwordHash) return false;
  return verifyPasswordHash(plain, user.passwordHash);
}

/**
 * Capability gate for route handlers. Returns null when the current user holds
 * `cap`, a 401 when unauthenticated, or a 403 otherwise — same null-or-response
 * shape as requireAuth(), so it drops in right after it:
 *
 *   const authError = await requireAuth();
 *   if (authError) return authError;
 *   const capError = await requireCapability('series.delete');
 *   if (capError) return capError;
 *
 * This is the real, tamper-proof security boundary (UI hiding is cosmetic).
 */
export async function requireCapability(cap: Capability): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!can(user, cap)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
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
