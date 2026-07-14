import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import { localPasswordValidationError } from '@/lib/password-policy';
import { toSafeUser } from '@/lib/user-dto';
import { withApiLogging } from '@/lib/api-logger';

const ROLES = new Set(['admin', 'member']);
const TEMPLATES = new Set(['admin', 'member']);

async function getHandler(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  return NextResponse.json(users.map(toSafeUser));
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

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = typeof body.role === 'string' && ROLES.has(body.role) ? body.role : 'member';
  const template =
    typeof body.template === 'string' && TEMPLATES.has(body.template) ? body.template : role;
  const jellyfinUserId =
    typeof body.jellyfinUserId === 'string' && body.jellyfinUserId.trim()
      ? body.jellyfinUserId.trim()
      : null;
  const seerrUserId =
    typeof body.seerrUserId === 'string' && body.seerrUserId.trim() ? body.seerrUserId.trim() : null;

  if (!username) return NextResponse.json({ error: 'Username is required' }, { status: 400 });
  if (username.length > 64) return NextResponse.json({ error: 'Username too long' }, { status: 400 });
  if (!displayName) return NextResponse.json({ error: 'Display name is required' }, { status: 400 });
  // A local password OR a Jellyfin link is required, else the account can never sign in.
  if (!password && !jellyfinUserId) {
    return NextResponse.json(
      { error: 'Provide a password or link a Jellyfin account so the user can sign in' },
      { status: 400 }
    );
  }
  const passwordError = password ? localPasswordValidationError(password) : null;
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  const passwordHash = password ? await hashPassword(password) : null;

  try {
    const created = await prisma.user.create({
      data: {
        username,
        displayName,
        passwordHash,
        role: role as User['role'],
        status: 'active',
        template,
        jellyfinUserId,
        seerrUserId,
      },
    });
    return NextResponse.json(toSafeUser(created), { status: 201 });
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
