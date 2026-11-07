import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { grantableScopes } from '@/lib/api-tokens';
import { can } from '@/lib/permissions';

/**
 * Admin: a user's personal API tokens, for Settings -> Users. The same fields
 * the owner sees (never a hash), and whether the user may make and use tokens.
 * Turning one off is ./[tokenId].
 */
async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { role: true, template: true, permissions: true },
  });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = await prisma.apiToken.findMany({
    where: { userId: id },
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
    allowed: can(user, 'api.tokens'),
  });
}

export const GET = withApiLogging(getHandler, 'api/users/[id]/api-tokens');
