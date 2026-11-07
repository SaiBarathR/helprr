import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import { localPasswordValidationError } from '@/lib/password-policy';
import {
  localUsernameValidationError,
  normalizeLocalUsername,
} from '@/lib/username-policy';
import { toSafeUser } from '@/lib/user-dto';
import { parsePermissions } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';
import { refreshRecommendationsAfterLink } from '@/lib/recommendations/engine';
import { changedFieldNames, recordSecurityEvent } from '@/lib/security-audit';
import { deleteUserUnlessLastAdmin, lockActiveAdminGuard } from '@/lib/user-deletion';
import { confirmAdminStepUp } from '@/lib/server/confirm-password';

const ROLES = new Set(['admin', 'member']);
const STATUSES = new Set(['active', 'pending', 'disabled']);
const AUDITED_FIELDS = ['username', 'displayName', 'role', 'status', 'template', 'jellyfinUserId', 'seerrUserId'] as const;

async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    ...toSafeUser(user),
    permissions: parsePermissions(user.permissions),
  });
}

async function patchHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data: Partial<{
    username: string;
    displayName: string;
    role: User['role'];
    status: User['status'];
    template: string;
    permissions: object;
    jellyfinUserId: string | null;
    seerrUserId: string | null;
    passwordHash: string;
  }> = {};

  if (typeof body.username === 'string') {
    const next = normalizeLocalUsername(body.username);
    const usernameError = localUsernameValidationError(next);
    if (usernameError) {
      return NextResponse.json({ error: usernameError }, { status: 400 });
    }
    data.username = next;
  }
  if (typeof body.displayName === 'string' && body.displayName.trim()) {
    data.displayName = body.displayName.trim();
  }
  if (typeof body.role === 'string') {
    if (!ROLES.has(body.role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }
    data.role = body.role as User['role'];
  }
  if (typeof body.status === 'string') {
    if (!STATUSES.has(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    data.status = body.status as User['status'];
  }
  if ('jellyfinUserId' in body) {
    data.jellyfinUserId =
      typeof body.jellyfinUserId === 'string' && body.jellyfinUserId.trim()
        ? body.jellyfinUserId.trim()
        : null;
  }
  if ('seerrUserId' in body) {
    data.seerrUserId =
      typeof body.seerrUserId === 'string' && body.seerrUserId.trim()
        ? body.seerrUserId.trim()
        : null;
  }
  if (typeof body.password === 'string' && body.password) {
    const passwordError = localPasswordValidationError(body.password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }
  }

  // Making someone admin, or setting another admin's password or Jellyfin link
  // (a way into their account, as a reset link is), needs the acting admin's
  // password (and code), not just a session.
  const promoting = data.role === 'admin' && existing.role !== 'admin';
  const intoOtherAdmin = existing.role === 'admin' && existing.id !== admin.user.id && (
    (typeof body.password === 'string' && body.password.length > 0)
    || (data.jellyfinUserId !== undefined && data.jellyfinUserId !== existing.jellyfinUserId)
  );
  if (promoting || intoOtherAdmin) {
    const stepUp = await confirmAdminStepUp(request, admin.user, body, promoting ? 'make-admin' : 'admin-credentials');
    if (stepUp) return stepUp;
  }

  if (typeof body.password === 'string' && body.password) {
    data.passwordHash = await hashPassword(body.password);
  }

  // Changing role realigns the template and clears per-cap overrides — an admin
  // has no meaningful deltas, and a fresh member should start from the template.
  if (data.role && data.role !== existing.role) {
    data.template = data.role;
    data.permissions = {};
  }

  // Last-admin guard: never let the final active admin be demoted or disabled.
  const losingAdmin =
    existing.role === 'admin' &&
    existing.status === 'active' &&
    ((data.role && data.role !== 'admin') || (data.status && data.status !== 'active'));

  try {
    // Re-check the admin count and write in one transaction so two concurrent
    // demotions can't both pass the guard and leave zero active admins.
    const result = await prisma.$transaction(async (tx) => {
      if (losingAdmin) {
        await lockActiveAdminGuard(tx);
        const remaining = await tx.user.count({
          where: { role: 'admin', status: 'active', NOT: { id } },
        });
        if (remaining === 0) return { ok: false as const };
      }
      // A status change applies only to the status the admin saw, so an invite
      // accepted meanwhile is not turned back to pending (or a disable undone).
      // A role, password or Jellyfin change applies only to the role it saw, as
      // whether it needed the step-up above depends on it.
      const statusChanges = data.status !== undefined && data.status !== existing.status;
      const roleDecides = data.role !== undefined || data.passwordHash !== undefined || data.jellyfinUserId !== undefined;
      const updated = await tx.user.update({
        where: {
          id,
          ...(statusChanges ? { status: existing.status } : {}),
          ...(roleDecides ? { role: existing.role } : {}),
        },
        data,
      });
      // Admin password resets do not prove possession of any existing session,
      // so revoke every live session for the target in the same transaction.
      let revokedSessions = 0;
      let endedLink = false;
      if (data.passwordHash !== undefined) {
        const revoked = await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        revokedSessions = revoked.count;
      }
      // A password set here, or any status change, ends an outstanding invite
      // or reset link, so an old link can't later override the admin's choice.
      // Making someone admin ends it too: it was made without the step-up.
      if (data.passwordHash !== undefined || statusChanges || promoting) {
        endedLink = (await tx.passwordLink.deleteMany({ where: { userId: id } })).count > 0;
      }
      // A reset or a disable also ends the calendar feed link, so re-enabling
      // the account does not bring an old link back.
      // Personal API tokens end the same way.
      let feedRevoked = false;
      let apiTokensRevoked = 0;
      const credentialsReset = data.passwordHash !== undefined || (data.status && data.status !== 'active');
      if (credentialsReset) {
        const feed = await tx.calendarFeedToken.deleteMany({ where: { userId: id } });
        feedRevoked = feed.count > 0;
      }
      // A Jellyfin relink is a password change for a Jellyfin-only account.
      if (credentialsReset || (data.jellyfinUserId !== undefined && data.jellyfinUserId !== existing.jellyfinUserId)) {
        apiTokensRevoked = (await tx.apiToken.deleteMany({ where: { userId: id } })).count;
      }
      return { ok: true as const, updated, revokedSessions, endedLink, feedRevoked, apiTokensRevoked };
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: 'Cannot demote or disable the last active admin' },
        { status: 409 }
      );
    }
    // A new Jellyfin link or role changes what the user's recommendations read
    // (an admin falls back to the operator's Jellyfin user and AniList
    // account). A failure only delays that until the profile's next rebuild.
    if (result.updated.jellyfinUserId !== existing.jellyfinUserId || result.updated.role !== existing.role) {
      await refreshRecommendationsAfterLink(id).catch((error) =>
        console.error('[Users] Failed to refresh recommendations after a Jellyfin link change:', error),
      );
    }
    // A role change keeps the new role ("made admin"), so the log answers who gave whom admin.
    const fields = changedFieldNames(existing, result.updated, AUDITED_FIELDS)
      .map((field) => (field === 'role' ? `made ${result.updated.role}` : field));
    if (JSON.stringify(existing.permissions) !== JSON.stringify(result.updated.permissions)) fields.push('permissions');
    // A reset password revokes the user's sessions in the same transaction.
    if (data.passwordHash !== undefined) fields.push('password');
    if (result.endedLink) fields.push('passwordLink');
    if (fields.length > 0) {
      await recordSecurityEvent(request, {
        actor: admin.user,
        action: 'USER_UPDATED',
        targetType: 'user',
        targetId: id,
        targetLabel: result.updated.username,
        fields,
        // Sessions the password reset revoked; 1 for any other change.
        ...(data.passwordHash !== undefined ? { count: result.revokedSessions } : {}),
      });
    }
    if (result.feedRevoked) {
      await recordSecurityEvent(request, {
        actor: admin.user,
        action: 'CALENDAR_FEED_REVOKED',
        targetType: 'user',
        targetId: id,
        targetLabel: result.updated.username,
        fields: data.passwordHash !== undefined ? ['password'] : ['status'],
      });
    }
    if (result.apiTokensRevoked > 0) {
      await recordSecurityEvent(request, {
        actor: admin.user,
        action: 'API_TOKEN_REVOKED',
        targetType: 'user',
        targetId: id,
        targetLabel: result.updated.username,
        fields: data.passwordHash !== undefined ? ['password'] : ['status'],
        count: result.apiTokensRevoked,
      });
    }
    return NextResponse.json(toSafeUser(result.updated));
  } catch (error) {
    if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Username or Jellyfin link already in use' }, { status: 409 });
    }
    // P2025: the status or role changed after it was read (the conditions above).
    if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: 'This user changed while saving. Reload and try again.' }, { status: 409 });
    }
    console.error('[Users] update failed:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const ok = await prisma.$transaction((tx) => deleteUserUnlessLastAdmin(tx, existing));
  if (!ok) {
    return NextResponse.json({ error: 'Cannot delete the last active admin' }, { status: 409 });
  }
  await recordSecurityEvent(request, {
    actor: admin.user,
    action: 'USER_DELETED',
    targetType: 'user',
    targetId: id,
    targetLabel: existing.username,
  });
  return NextResponse.json({ ok: true });
}

export const GET = withApiLogging(getHandler, 'api/users/[id]');
export const PATCH = withApiLogging(patchHandler, 'api/users/[id]', { logBodies: false });
export const DELETE = withApiLogging(deleteHandler, 'api/users/[id]');
