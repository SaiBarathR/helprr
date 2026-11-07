import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { recordSecurityEvent } from '@/lib/security-audit';

/**
 * Admin: turn off one of a user's personal API tokens; it is refused from the
 * next request. The audit row names the admin (actor), the owner (target) and
 * the token. A token of another user answers 404.
 */
async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tokenId: string }> }
): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const { id, tokenId } = await params;

  try {
    const where = { id: tokenId, userId: id };
    const token = await prisma.apiToken.findFirst({
      where,
      select: { name: true, user: { select: { username: true } } },
    });
    if (!token) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // Of two admins at once, only the one whose delete lands records it.
    const result = await prisma.apiToken.deleteMany({ where });
    if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await recordSecurityEvent(request, {
      actor: admin.user,
      action: 'API_TOKEN_REVOKED',
      targetType: 'user',
      targetId: id,
      targetLabel: token.user.username,
      // 'admin', then the token's name (never its value or hash).
      fields: ['admin', token.name],
    });
    return NextResponse.json({ revoked: true });
  } catch (error) {
    console.error(`[ApiToken] Failed to turn off a user's token: ${error instanceof Error ? error.name : 'unknown error'}`);
    return NextResponse.json({ error: 'Failed to turn off the API token' }, { status: 500 });
  }
}

export const DELETE = withApiLogging(deleteHandler, 'api/users/[id]/api-tokens/[tokenId]', { logBodies: false });
