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
import { withApiLogging } from '@/lib/api-logger';
import { recordSecurityEvent } from '@/lib/security-audit';
import { issuePasswordLink, type IssuedPasswordLink } from '@/lib/password-links';
import { configuredAppOrigin, INVALID_APP_ORIGIN_LINK_ERROR, isAppOriginInvalid } from '@/lib/request-utils';

const ROLES = new Set(['admin', 'member']);
const TEMPLATES = new Set(['admin', 'member']);

async function getHandler(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    include: { passwordLink: { select: { purpose: true, expiresAt: true } } },
  });
  return NextResponse.json(users.map(({ passwordLink, ...user }) => ({
    ...toSafeUser(user),
    passwordLink,
  })));
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const username = typeof body.username === 'string'
    ? normalizeLocalUsername(body.username)
    : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  // Invite: a pending account with no password, and a link for the person to choose one.
  const invite = body.invite === true;
  const role = typeof body.role === 'string' && ROLES.has(body.role) ? body.role : 'member';
  const template =
    typeof body.template === 'string' && TEMPLATES.has(body.template) ? body.template : role;
  const jellyfinUserId =
    typeof body.jellyfinUserId === 'string' && body.jellyfinUserId.trim()
      ? body.jellyfinUserId.trim()
      : null;
  const seerrUserId =
    typeof body.seerrUserId === 'string' && body.seerrUserId.trim() ? body.seerrUserId.trim() : null;

  const usernameError = localUsernameValidationError(username);
  if (usernameError) {
    return NextResponse.json({ error: usernameError }, { status: 400 });
  }
  if (!displayName) return NextResponse.json({ error: 'Display name is required' }, { status: 400 });
  if (invite && password) {
    return NextResponse.json(
      { error: 'An invited user chooses their own password; leave the password blank' },
      { status: 400 }
    );
  }
  // A local password, an invite, or a Jellyfin link is required, else the account can never sign in.
  if (!password && !invite && !jellyfinUserId) {
    return NextResponse.json(
      { error: 'Provide a password or link a Jellyfin account so the user can sign in' },
      { status: 400 }
    );
  }
  const passwordError = password ? localPasswordValidationError(password) : null;
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  // An invite link on the wrong address would not reach the person: make no user.
  if (invite && isAppOriginInvalid()) {
    return NextResponse.json({ error: INVALID_APP_ORIGIN_LINK_ERROR }, { status: 500 });
  }

  const passwordHash = password ? await hashPassword(password) : null;

  try {
    const { created, link } = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username,
          displayName,
          passwordHash,
          role: role as User['role'],
          status: invite ? 'pending' : 'active',
          template,
          jellyfinUserId,
          seerrUserId,
        },
      });
      const link: IssuedPasswordLink | null = invite
        ? await issuePasswordLink(tx, { userId: created.id, purpose: 'invite', createdById: admin.user.id })
        : null;
      return { created, link };
    });
    await recordSecurityEvent(request, {
      actor: admin.user,
      action: 'USER_CREATED',
      targetType: 'user',
      targetId: created.id,
      targetLabel: created.username,
      fields: [
        'username',
        'displayName',
        'role',
        ...(passwordHash ? ['password'] : []),
        ...(jellyfinUserId ? ['jellyfinUserId'] : []),
        ...(seerrUserId ? ['seerrUserId'] : []),
      ],
    });
    if (link) {
      await recordSecurityEvent(request, {
        actor: admin.user,
        action: 'INVITE_CREATED',
        targetType: 'user',
        targetId: created.id,
        targetLabel: created.username,
      });
    }
    return NextResponse.json(
      {
        ...toSafeUser(created),
        passwordLink: link ? { purpose: link.purpose, expiresAt: link.expiresAt } : null,
        // The invite token is in this response only; the database keeps its hash.
        // The link is built on APP_ORIGIN when set (null: unset, the page's own address).
        ...(link ? { linkToken: link.token, linkOrigin: configuredAppOrigin() } : {}),
      },
      { status: 201 }
    );
  } catch (error) {
    // Unique violations on username / jellyfinUserId.
    if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
      return NextResponse.json(
        { error: 'Username or Jellyfin link already in use' },
        { status: 409 }
      );
    }
    console.error('[Users] create failed:', error);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/users');
export const POST = withApiLogging(postHandler, 'api/users', { logBodies: false });
