import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { issuePasswordLink, passwordLinkPurposeFor, revokePasswordLink } from '@/lib/password-links';
import { recordSecurityEvent } from '@/lib/security-audit';
import { boundedBodyErrorResponse, readBoundedJson } from '@/lib/server/bounded-body';
import { confirmPasswordAndSecondFactor } from '@/lib/server/confirm-password';
import { isTotpEnabled } from '@/lib/totp';
import { configuredAppOrigin, INVALID_APP_ORIGIN_LINK_ERROR, isAppOriginInvalid } from '@/lib/request-utils';

const SELF_LINK_NEEDS_FACTORS =
  'To make a reset link for yourself while your two-step sign-in is on, enter your current password and a code from your authenticator app (or a recovery code).';
const BODY_MAX_BYTES = 8 * 1024;

/**
 * Make a new invite link (pending user) or password-reset link (active local
 * user), ending any earlier one. The token is in this response only; the
 * database keeps its hash. `origin` is the configured APP_ORIGIN the link is
 * built on (null: unset, and the page uses its own address). A set but invalid
 * APP_ORIGIN makes no link rather than one on the wrong address.
 *
 * A reset link for your own account while your two-step sign-in is on needs
 * your current password and a code (or a recovery code), checked as turning
 * two-step sign-in off checks them: using the link turns it off, so a
 * signed-in session alone must not be able to make one. Links for other
 * people need neither.
 */
async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  // JSON only, so a same-site form cannot replace a link. The body is read only
  // for your own reset link (the password and code).
  let body: unknown;
  try {
    body = await readBoundedJson<unknown>(request, BODY_MAX_BYTES);
  } catch (error) {
    const response = boundedBodyErrorResponse(error);
    if (!response) throw error;
    return response;
  }

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true, status: true, passwordHash: true, passwordLink: { select: { purpose: true } } },
  });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const purpose = passwordLinkPurposeFor(user);
  if (!purpose) {
    return NextResponse.json(
      {
        error: user.status === 'disabled'
          ? 'This account is disabled. Enable it first.'
          : 'This account signs in with Jellyfin only. Set a password for it in Edit instead.',
      },
      { status: 409 }
    );
  }

  if (isAppOriginInvalid()) {
    return NextResponse.json({ error: INVALID_APP_ORIGIN_LINK_ERROR }, { status: 500 });
  }

  // admin.user is re-read from the database for this request, so its two-step state is current.
  if (purpose === 'reset' && user.id === admin.user.id && isTotpEnabled(admin.user)) {
    const { currentPassword, code } = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as {
      currentPassword?: unknown;
      code?: unknown;
    };
    if (
      typeof currentPassword !== 'string' || currentPassword.length === 0
      || typeof code !== 'string' || code.trim().length === 0 || code.length > 64
    ) {
      return NextResponse.json({ error: SELF_LINK_NEEDS_FACTORS, needsSecondFactor: true }, { status: 403 });
    }
    const confirmed = await confirmPasswordAndSecondFactor(request, admin.user, currentPassword, code);
    if (!confirmed.ok) return confirmed.response;
    if (confirmed.factor === 'recovery-code') {
      await recordSecurityEvent(request, {
        actor: admin.user,
        action: 'MFA_RECOVERY_CODE_USED',
        targetType: 'user',
        targetId: admin.user.id,
        targetLabel: admin.user.username,
        fields: ['reset-link'],
      });
    }
  }

  const link = await issuePasswordLink(prisma, { userId: user.id, purpose, createdById: admin.user.id });
  await recordSecurityEvent(request, {
    actor: admin.user,
    action: purpose === 'reset'
      ? 'RESET_LINK_CREATED'
      : user.passwordLink?.purpose === 'invite' ? 'INVITE_REGENERATED' : 'INVITE_CREATED',
    targetType: 'user',
    targetId: user.id,
    targetLabel: user.username,
  });
  return NextResponse.json({ ...link, origin: configuredAppOrigin() }, { status: 201 });
}

async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const purpose = await revokePasswordLink(prisma, user.id);
  if (purpose) {
    await recordSecurityEvent(request, {
      actor: admin.user,
      action: purpose === 'invite' ? 'INVITE_REVOKED' : 'RESET_LINK_REVOKED',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.username,
    });
  }
  return NextResponse.json({ revoked: purpose !== null });
}

// Never log bodies: the POST response carries the token.
export const POST = withApiLogging(postHandler, 'api/users/[id]/password-link', { logBodies: false });
export const DELETE = withApiLogging(deleteHandler, 'api/users/[id]/password-link', { logBodies: false });
