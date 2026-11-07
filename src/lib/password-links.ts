import { createHash, randomBytes } from 'crypto';
import type { PasswordLinkPurpose, Prisma, User, UserStatus } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Single-use links an admin hands to someone so they set their own local
 * password (Settings -> Users). An invite activates a pending user; a reset
 * replaces an active user's password, revokes every session of theirs and
 * turns off their two-step sign-in (the way back for a lost phone), when the
 * link was made after it was turned on (an admin's own link included).
 *
 * The token is 32 random bytes; only its SHA-256 is stored, so a database read
 * never yields a working link. Each user has at most one link: issuing another
 * replaces the stored hash, which ends the old link. A link works once, before
 * it expires, and only while the user is still in the state it was made for.
 * A password set or a status change in Settings -> Users also ends the link
 * (PATCH /api/users/[id]).
 */

export const INVITE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_LINK_TTL_MS = 24 * 60 * 60 * 1000;

const TOKEN_BYTES = 32;
// base64url of 32 bytes, unpadded.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The user status a link of each purpose is usable for. */
const STATUS_FOR_PURPOSE: Record<PasswordLinkPurpose, UserStatus> = {
  invite: 'pending',
  reset: 'active',
};

export interface IssuedPasswordLink {
  /** Shown to the admin once; never stored. */
  token: string;
  purpose: PasswordLinkPurpose;
  expiresAt: Date;
}

export function hashPasswordLinkToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isWellFormedPasswordLinkToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/** The purpose a new link for this user gets, or null when none may be issued. */
export function passwordLinkPurposeFor(user: Pick<User, 'status' | 'passwordHash'>): PasswordLinkPurpose | null {
  if (user.status === 'pending') return 'invite';
  // Reset links are for local accounts; a Jellyfin-only account has no password to reset.
  if (user.status === 'active' && user.passwordHash !== null) return 'reset';
  return null;
}

/** Create the user's link, replacing (and so ending) any earlier one. */
export async function issuePasswordLink(
  db: Prisma.TransactionClient,
  input: { userId: string; purpose: PasswordLinkPurpose; createdById: string; now?: Date },
): Promise<IssuedPasswordLink> {
  const now = input.now ?? new Date();
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const tokenHash = hashPasswordLinkToken(token);
  const expiresAt = new Date(now.getTime() + (input.purpose === 'invite' ? INVITE_LINK_TTL_MS : RESET_LINK_TTL_MS));
  const fields = { purpose: input.purpose, tokenHash, expiresAt, createdById: input.createdById, createdAt: now };
  await db.passwordLink.upsert({
    where: { userId: input.userId },
    create: { userId: input.userId, ...fields },
    update: fields,
  });
  return { token, purpose: input.purpose, expiresAt };
}

/** End the user's link, if there is one. Returns the purpose of the link ended, or null for none. */
export async function revokePasswordLink(db: Prisma.TransactionClient, userId: string): Promise<PasswordLinkPurpose | null> {
  try {
    const deleted = await db.passwordLink.delete({ where: { userId }, select: { purpose: true } });
    return deleted.purpose;
  } catch (error) {
    // P2025: no link to end (none made, already used, or revoked meanwhile).
    if ((error as { code?: unknown } | null)?.code === 'P2025') return null;
    throw error;
  }
}

type LinkWithUser = Prisma.PasswordLinkGetPayload<{ include: { user: true } }>;

// The row is found by an equality lookup on the token's SHA-256. That needs no
// constant-time compare: a timing leak could only reveal bits of a stored hash,
// and finding a token with a chosen hash prefix is as hard as guessing a token.
function usable(link: LinkWithUser | null, now: Date): link is LinkWithUser {
  if (!link) return false;
  if (link.expiresAt.getTime() <= now.getTime()) return false;
  return link.user.status === STATUS_FOR_PURPOSE[link.purpose];
}

/**
 * What the invite page shows before the password is chosen, or null for any
 * link that cannot be used (unknown, malformed, expired, used, revoked, or the
 * user is no longer in the state it was made for), all alike.
 */
export async function describePasswordLink(
  token: unknown,
  now = new Date(),
): Promise<{ purpose: PasswordLinkPurpose; username: string; displayName: string } | null> {
  if (!isWellFormedPasswordLinkToken(token)) return null;
  const tokenHash = hashPasswordLinkToken(token);
  const link = await prisma.passwordLink.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!usable(link, now)) return null;
  return { purpose: link.purpose, username: link.user.username, displayName: link.user.displayName };
}

class LinkUnusableError extends Error {}

/**
 * Use a link: set the password, make the user active, end the link and revoke
 * every session of the user, all in one transaction; a reset someone else
 * made after two-step sign-in was turned on also turns it off. Returns null for a link that
 * cannot be used, in which case nothing is written.
 */
export async function redeemPasswordLink(
  token: unknown,
  passwordHash: string,
  now = new Date(),
): Promise<{
  id: string;
  username: string;
  role: User['role'];
  purpose: PasswordLinkPurpose;
  revokedSessions: number;
  feedRevoked: boolean;
  /** Personal API tokens the reset ended. */
  apiTokensRevoked: number;
  /** Two-step sign-in is still on: the new password alone must not sign in. */
  mfaEnabled: boolean;
  /** This reset turned two-step sign-in off. */
  mfaDisabled: boolean;
  /** Who made the link, when that account still exists: the one who turned two-step sign-in off. */
  linkCreator: { id: string; username: string } | null;
} | null> {
  if (!isWellFormedPasswordLinkToken(token)) return null;
  const tokenHash = hashPasswordLinkToken(token);
  try {
    return await prisma.$transaction(async (tx) => {
      const link = await tx.passwordLink.findUnique({ where: { tokenHash }, include: { user: true } });
      if (!usable(link, now)) throw new LinkUnusableError();
      // User row first, as Settings -> Users and Account -> Change password
      // lock it, so concurrent changes queue instead of deadlocking. The status
      // condition makes a disable or status change that landed first win.
      const updated = await tx.user.updateMany({
        where: { id: link.userId, status: STATUS_FOR_PURPOSE[link.purpose] },
        data: { passwordHash, status: 'active' },
      });
      if (updated.count !== 1) throw new LinkUnusableError();
      // Read now, with the row locked by the update: two-step sign-in turned on
      // after the link was read still counts.
      const mfa = await tx.user.findUnique({ where: { id: link.userId }, select: { totpEnabledAt: true } });
      const enabledAt = mfa ? mfa.totpEnabledAt : undefined;
      const mfaWasOn = enabledAt !== null;
      // A reset made after it was turned on is how someone who lost their
      // phone gets back in, an admin with their own link too (it still takes
      // the link and a new password, and signs out every session). An older
      // link is not: it predates the second factor it would remove.
      const mfaDisabled = enabledAt instanceof Date
        && link.purpose === 'reset'
        && link.createdAt.getTime() > enabledAt.getTime();
      if (mfaDisabled) {
        await tx.user.updateMany({
          where: { id: link.userId },
          data: { totpSecret: null, totpEnabledAt: null, totpLastUsedStep: null },
        });
        await tx.recoveryCode.deleteMany({ where: { userId: link.userId } });
      }
      // Single use: of two requests with the same link, only one deletes it.
      // Matching the hash too means a link reissued meanwhile is not consumed.
      const consumed = await tx.passwordLink.deleteMany({ where: { id: link.id, tokenHash } });
      if (consumed.count !== 1) throw new LinkUnusableError();
      const revoked = await tx.session.updateMany({
        where: { userId: link.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      // The calendar feed link is a credential too; a reset ends it with the sessions.
      const feed = await tx.calendarFeedToken.deleteMany({ where: { userId: link.userId } });
      const apiTokens = await tx.apiToken.deleteMany({ where: { userId: link.userId } });
      const linkCreator = link.createdById
        ? await tx.user.findUnique({ where: { id: link.createdById }, select: { id: true, username: true } })
        : null;
      return {
        id: link.user.id,
        username: link.user.username,
        role: link.user.role,
        purpose: link.purpose,
        revokedSessions: revoked.count,
        feedRevoked: feed.count > 0,
        apiTokensRevoked: apiTokens.count,
        mfaEnabled: mfaWasOn && !mfaDisabled,
        mfaDisabled,
        linkCreator,
      };
    });
  } catch (error) {
    if (error instanceof LinkUnusableError) return null;
    throw error;
  }
}
