import { createHash, createHmac } from 'crypto';
import { isIP } from 'net';
import type { NextRequest } from 'next/server';
import { Prisma, type SecurityAuditAction } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getClientIp } from '@/lib/login-rate-limit';
import { currentRequestContext } from '@/lib/request-context';
import { findServiceByType } from '@/lib/settings/service-config';
import { LOCAL_USERNAME_MAX_CODE_POINTS } from '@/lib/username-policy';

// ─────────────────────────────────────────────────────────────────────────────
// Security and admin audit trail: account, permission, session, service
// connection and settings-import changes, database backups, and sign-ins. Each row says who did
// what to which target, and which FIELD NAMES changed: never a value, a hash, a
// key or a password (the one value kept is a new role, as "made admin"; a failed
// sign-in keeps the username as typed). Writes are fail-soft, made after the action, and never
// stand in for authorization: a failed write logs one line and the action's
// own response is returned unchanged.
// ─────────────────────────────────────────────────────────────────────────────

const USER_AGENT_MAX = 256;
const COALESCE_WINDOW_MS = 60_000;

export interface SecurityAuditActor {
  id: string;
  username: string;
}

export type SecurityAuditTargetType = 'user' | 'session' | 'service' | 'settings' | 'backup' | 'api-token';

export interface SecurityAuditInput {
  /**
   * Who acted; null for a failed sign-in, where nobody is signed in, or a start-up
   * reset. A scheduled job has a null id and a `system:<label>` name.
   */
  actor: SecurityAuditActor | { id: null; username: string } | null;
  action: SecurityAuditAction;
  targetType: SecurityAuditTargetType;
  targetId?: string | null;
  targetLabel?: string | null;
  /** Names only, e.g. ['displayName', 'password'] (a role change: 'made admin'; a backup: its trigger and size). Never pass a secret. */
  fields?: string[] | null;
  /** Items the one action covered, e.g. sessions revoked at once. */
  count?: number;
}

function ipv4ToCidr24(ip: string): string {
  const parts = ip.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

/**
 * An IPv4 address to its /24, an IPv6 one to its /64, an IPv4-mapped IPv6 one
 * (in any spelling) to its IPv4 /24; anything else to null.
 */
export function coarseIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const family = isIP(ip);
  if (family === 4) return ipv4ToCidr24(ip);
  if (family !== 6) return null;

  const [head, tail = ''] = ip.toLowerCase().split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  // An embedded IPv4 tail ("::ffff:1.2.3.4") fills two groups.
  const groups = (parts: string[]) => parts.reduce((n, part) => n + (part.includes('.') ? 2 : 1), 0);
  const missing = 8 - groups(headParts) - groups(tailParts);
  const full = ip.includes('::')
    ? [...headParts, ...Array(Math.max(0, missing)).fill('0'), ...tailParts]
    : headParts;
  const hex = full.map((part) => (part.includes('.') ? part : (parseInt(part, 16) || 0).toString(16)));

  // ::ffff:a.b.c.d, 0:0:0:0:0:ffff:a.b.c.d or ::ffff:0102:0304: the first
  // five groups are zero and the sixth is ffff.
  if (hex.slice(0, 5).every((part) => part === '0') && hex[5] === 'ffff') {
    if (hex[6]?.includes('.')) return ipv4ToCidr24(hex[6]);
    const high = parseInt(hex[6] ?? '0', 16);
    const low = parseInt(hex[7] ?? '0', 16);
    return ipv4ToCidr24(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
  }
  return `${hex.slice(0, 4).join(':')}::/64`;
}

function requestMeta(request: NextRequest | null): { ip: string | null; userAgent: string | null } {
  if (!request) return { ip: null, userAgent: null };
  const userAgent = request.headers.get('user-agent');
  return {
    ip: coarseIp(getClientIp(request)),
    userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null,
  };
}

function logWriteFailure(error: unknown): void {
  // Name and code only: a Prisma message can echo the arguments.
  const code = (error as { code?: unknown } | null)?.code;
  const reason = error instanceof Error
    ? `${error.name}${typeof code === 'string' ? ` ${code}` : ''}`
    : 'unknown error';
  console.error(`[SecurityAudit] Failed to write audit row: ${reason}`);
}

/** Record one security event; request is null outside a request (at start-up, or a scheduled job). Never throws. */
export async function recordSecurityEvent(request: NextRequest | null, input: SecurityAuditInput): Promise<void> {
  try {
    await prisma.securityAuditEvent.create({
      data: {
        actorUserId: input.actor?.id ?? null,
        actorUsername: input.actor?.username ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        targetLabel: input.targetLabel ?? null,
        fields: input.fields?.length ? (input.fields as Prisma.InputJsonValue) : Prisma.JsonNull,
        count: input.count ?? 1,
        ...(request ? requestMeta(request) : { ip: null, userAgent: null }),
        requestId: currentRequestContext()?.requestId ?? null,
      },
    });
  } catch (error) {
    logWriteFailure(error);
  }
}

/**
 * 'jellyfin-unlinked': Jellyfin took the password, but no Helprr profile is linked to that account.
 * 'jellyfin-wrong-account': a member connecting their own Jellyfin account signed in to a different one.
 * 'totp': a wrong two-step sign-in code (authenticator or recovery code), after a right password.
 * 'trusted-header-secret': a trusted-header sign-in without the proxy's secret.
 * 'trusted-header-no-account': the sign-in proxy named no active Helprr account.
 */
export type SignInMethod =
  | 'password'
  | 'jellyfin'
  | 'jellyfin-unlinked'
  | 'jellyfin-wrong-account'
  | 'totp'
  | 'trusted-header-secret'
  | 'trusted-header-no-account';

export interface FailedSignInInput {
  /** The username as typed, normalized. */
  username: string;
  method: SignInMethod;
  /**
   * The active Helprr account the name belongs to, or null for none. Left out,
   * it is looked up. The password route passes it, so its unknown-user and
   * wrong-password paths do the same work.
   */
  user?: SecurityAuditActor | null;
  /** Jellyfin accepted the name (only the account was wrong): a Jellyfin name, not looked up as a Helprr one. */
  nameIsAccount?: boolean;
  /** The signed-in user, when a self-service check failed. */
  actor?: SecurityAuditActor | null;
  nowMs?: number;
}

// Controls, format characters (zero-width, bidi, soft hyphen, tags) and line or
// paragraph separators: what can make a name display as something it is not.
const UNSAFE_LABEL_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * A typed username as the row keeps it: control and bidi characters removed,
 * at most LOCAL_USERNAME_MAX_CODE_POINTS code points. The owner accepted that a
 * password typed into the username box is kept too (2026-11-07).
 */
export function typedUsernameLabel(username: string): string {
  const label = Array.from(username.replace(UNSAFE_LABEL_CHARS, ''))
    .slice(0, LOCAL_USERNAME_MAX_CODE_POINTS)
    .join('');
  return label.trim() || '(unprintable)';
}

/**
 * Record a failed sign-in and the coarse IP. The username is kept as typed
 * (see typedUsernameLabel), with the account as the target when it names one.
 * Attempts with the same method, username, actor and IP in the same minute add
 * to one row's count, so a flood of guesses is a few rows, not thousands.
 * Never throws.
 */
export async function recordFailedSignIn(request: NextRequest, input: FailedSignInInput): Promise<void> {
  try {
    const meta = requestMeta(request);
    const actor = input.actor ?? null;
    const minute = Math.floor((input.nowMs ?? Date.now()) / COALESCE_WINDOW_MS);
    // Keyed on the full name. An HMAC under the server secret, not a bare
    // hash, so the key says nothing the row does not.
    const secret = process.env.JWT_SECRET || process.env.APP_PASSWORD;
    if (!secret) throw new Error('JWT_SECRET or APP_PASSWORD is required');
    const coalesceKey = createHmac('sha256', secret)
      .update(JSON.stringify(['security-audit:LOGIN_FAILED', input.method, minute, input.username, meta.ip, actor?.id ?? null]))
      .digest('hex');
    const user = input.user !== undefined || input.nameIsAccount
      ? input.user ?? null
      : await prisma.user.findFirst({
        where: { username: input.username, status: 'active' },
        select: { id: true, username: true },
      });
    const targetLabel = user ? user.username : typedUsernameLabel(input.username);
    await prisma.securityAuditEvent.upsert({
      where: { coalesceKey },
      update: { count: { increment: 1 } },
      create: {
        actorUserId: actor?.id ?? null,
        actorUsername: actor?.username ?? null,
        action: 'LOGIN_FAILED',
        targetType: 'user',
        targetId: user?.id ?? null,
        targetLabel,
        fields: [input.method],
        ...meta,
        requestId: currentRequestContext()?.requestId ?? null,
        coalesceKey,
      },
    });
  } catch (error) {
    logWriteFailure(error);
  }
}

/**
 * Record a try of an invite or reset link that could not be used. Nothing
 * about the token is kept: tries from one network in the same minute add to
 * one row's count, like failed sign-ins. Never throws.
 */
export async function recordFailedLinkAttempt(request: NextRequest, nowMs = Date.now()): Promise<void> {
  try {
    const meta = requestMeta(request);
    const minute = Math.floor(nowMs / COALESCE_WINDOW_MS);
    // A plain hash is enough: the key holds nothing that is not on the row.
    const coalesceKey = createHash('sha256')
      .update(JSON.stringify(['security-audit:INVITE_LINK_FAILED', minute, meta.ip]))
      .digest('hex');
    await prisma.securityAuditEvent.upsert({
      where: { coalesceKey },
      update: { count: { increment: 1 } },
      create: {
        actorUserId: null,
        actorUsername: null,
        action: 'INVITE_LINK_FAILED',
        targetType: 'user',
        targetId: null,
        targetLabel: null,
        fields: Prisma.JsonNull,
        ...meta,
        requestId: currentRequestContext()?.requestId ?? null,
        coalesceKey,
      },
    });
  } catch (error) {
    logWriteFailure(error);
  }
}

/** "Sonarr · HD" for a named instance, "Twitch" for a single-instance service. */
export function serviceTargetLabel(type: string, label: string): string {
  const name = findServiceByType(type)?.label;
  if (!name) return label || type;
  return label && label !== name ? `${name} · ${label}` : name;
}

/** Names of the keys whose values differ between before and after. */
export function changedFieldNames<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  keys: readonly (keyof T & string)[],
): string[] {
  return keys.filter((key) => key in after && after[key] !== before[key]);
}
