import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAuth, requireCapability } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import { toSafeUser, countActiveAdmins } from '@/lib/user-dto';
import { parsePermissions } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';

const ROLES = new Set(['admin', 'member']);
const STATUSES = new Set(['active', 'pending', 'disabled']);

async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('users.manage');
  if (capError) return capError;

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
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('users.manage');
  if (capError) return capError;

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

  if (typeof body.username === 'string' && body.username.trim()) {
    const next = body.username.trim();
    if (next.length > 64) {
      return NextResponse.json({ error: 'Username too long' }, { status: 400 });
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
    if (body.password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }
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
  if (losingAdmin && (await countActiveAdmins(id)) === 0) {
    return NextResponse.json(
      { error: 'Cannot demote or disable the last active admin' },
      { status: 409 }
    );
  }

  try {
    const updated = await prisma.user.update({ where: { id }, data });
    return NextResponse.json(toSafeUser(updated));
  } catch (error) {
    if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Username or Jellyfin link already in use' }, { status: 409 });
    }
    console.error('[Users] update failed:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

async function deleteHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('users.manage');
  if (capError) return capError;

  const { id } = await params;
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (existing.role === 'admin' && existing.status === 'active' && (await countActiveAdmins(id)) === 0) {
    return NextResponse.json({ error: 'Cannot delete the last active admin' }, { status: 409 });
  }

  // Cascade (schema onDelete: Cascade) drops their sessions, watchlist, push
  // subscriptions, AniList link, and settings with them.
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export const GET = withApiLogging(getHandler, 'api/users/[id]');
export const PATCH = withApiLogging(patchHandler, 'api/users/[id]', { logBodies: false });
export const DELETE = withApiLogging(deleteHandler, 'api/users/[id]');
