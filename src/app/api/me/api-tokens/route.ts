import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { API_TOKEN_SCOPES, isApiTokenScope } from '@/lib/api-token-scopes';
import {
  generateApiToken,
  grantableScopes,
  hashApiToken,
  MAX_API_TOKEN_EXPIRY_DAYS,
  MAX_API_TOKENS,
} from '@/lib/api-tokens';
import { recordSecurityEvent } from '@/lib/security-audit';

// The signed-in user's own personal API tokens for the read-only status API.
// Only a token's hash is kept, so the token itself is in the POST response
// alone. Turning one off is /api/me/api-tokens/[id]. Bodies are never logged.

const MAX_NAME_LENGTH = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Each token's name, scopes (and which of them the owner still holds), expiry,
 * and when it was made and last used, plus the scopes a new token may have.
 */
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const rows = await prisma.apiToken.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, scopes: true, expiresAt: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({
    tokens: rows.map((row) => ({
      id: row.id,
      name: row.name,
      scopes: row.scopes,
      activeScopes: grantableScopes(user, row.scopes),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    })),
    grantableScopes: grantableScopes(user, API_TOKEN_SCOPES.map((def) => def.scope)),
    max: MAX_API_TOKENS,
  });
}

/**
 * A token name: trimmed, 1–60 characters, none of the control, format (bidi,
 * zero-width) or separator characters that could make it display as something
 * else in the security log; null when not.
 */
function parseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > MAX_NAME_LENGTH || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)) return null;
  return name;
}

class SessionEndedError extends Error {}

/** Make a token ({ name, scopes: string[], expiresInDays: number | null }); the response holds it once. */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, session } = auth;

  const body = (await request.json().catch(() => null)) as
    { name?: unknown; scopes?: unknown; expiresInDays?: unknown } | null;
  const name = parseName(body?.name);
  if (!name) return NextResponse.json({ error: `Give the token a name of up to ${MAX_NAME_LENGTH} characters` }, { status: 400 });

  const requested = body?.scopes;
  if (
    !Array.isArray(requested)
    || requested.length === 0
    || requested.length > API_TOKEN_SCOPES.length
    || !requested.every(isApiTokenScope)
    || new Set(requested).size !== requested.length
  ) {
    return NextResponse.json({ error: 'Choose at least one thing the token may read' }, { status: 400 });
  }
  // A token can never read more than its owner can.
  if (grantableScopes(user, requested).length !== requested.length) {
    return NextResponse.json({ error: 'You can only give a token access you have yourself' }, { status: 403 });
  }

  const days = body?.expiresInDays ?? null;
  if (days !== null && !(Number.isInteger(days) && (days as number) >= 1 && (days as number) <= MAX_API_TOKEN_EXPIRY_DAYS)) {
    return NextResponse.json({ error: `Expiry must be 1 to ${MAX_API_TOKEN_EXPIRY_DAYS} days, or none` }, { status: 400 });
  }
  const expiresAt = days === null ? null : new Date(Date.now() + (days as number) * DAY_MS);

  try {
    // A soft cap: two requests at the same moment can each pass it once.
    if (await prisma.apiToken.count({ where: { userId: user.id } }) >= MAX_API_TOKENS) {
      return NextResponse.json({ error: `You can have up to ${MAX_API_TOKENS} API tokens; turn one off first` }, { status: 409 });
    }
    const token = generateApiToken();
    // Made only while this session is still live, holding its row: a password
    // change revokes sessions before it deletes tokens, so it either waits for
    // this token and deletes it, or ends this session first and this is refused.
    const row = await prisma.$transaction(async (tx) => {
      const live = await tx.session.updateMany({
        where: { id: session.id, userId: user.id, revokedAt: null },
        data: { lastSeenAt: new Date() },
      });
      if (live.count === 0) throw new SessionEndedError();
      return tx.apiToken.create({
        data: { userId: user.id, name, scopes: requested, expiresAt, tokenHash: hashApiToken(token) },
        select: { id: true, createdAt: true },
      });
    });
    await recordSecurityEvent(request, {
      actor: user,
      action: 'API_TOKEN_CREATED',
      targetType: 'api-token',
      targetId: row.id,
      targetLabel: name,
      fields: requested,
    });
    return NextResponse.json({
      id: row.id,
      token,
      name,
      scopes: requested,
      expiresAt: expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof SessionEndedError) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error(`[ApiToken] Failed to make a token: ${error instanceof Error ? error.name : 'unknown error'}`);
    return NextResponse.json({ error: 'Failed to make the API token' }, { status: 500 });
  }
}

const LOGGING = { logBodies: false } as const;
export const GET = withApiLogging(getHandler, 'api/me/api-tokens', LOGGING);
export const POST = withApiLogging(postHandler, 'api/me/api-tokens', LOGGING);
