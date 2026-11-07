import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { issuePasswordLink, passwordLinkPurposeFor, revokePasswordLink } from '@/lib/password-links';
import { recordSecurityEvent } from '@/lib/security-audit';
import { boundedBodyErrorResponse, readBoundedJson } from '@/lib/server/bounded-body';
import { configuredAppOrigin, INVALID_APP_ORIGIN_LINK_ERROR, isAppOriginInvalid } from '@/lib/request-utils';

/**
 * Make a new invite link (pending user) or password-reset link (active local
 * user), ending any earlier one. The token is in this response only; the
 * database keeps its hash. `origin` is the configured APP_ORIGIN the link is
 * built on (null: unset, and the page uses its own address). A set but invalid
 * APP_ORIGIN makes no link rather than one on the wrong address.
 */
async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  // JSON only (the body itself is unused), so a same-site form cannot replace a link.
  try {
    await readBoundedJson<unknown>(request, 1024);
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
