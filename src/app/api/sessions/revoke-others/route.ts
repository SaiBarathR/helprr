import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { recordSecurityEvent } from '@/lib/security-audit';

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    // "Revoke all other sessions" means *my* other devices — for admins too.
    // Force-logging out a specific member is done via the per-session revoke.
    const result = await prisma.session.updateMany({
      where: {
        revokedAt: null,
        userId: auth.user.id,
        NOT: { id: auth.session.id },
      },
      data: { revokedAt: new Date() },
    });
    if (result.count > 0) {
      await recordSecurityEvent(request, {
        actor: auth.user,
        action: 'SESSION_REVOKED',
        targetType: 'user',
        targetId: auth.user.id,
        targetLabel: auth.user.username,
        count: result.count,
      });
    }
    return NextResponse.json({ revoked: result.count });
  } catch (error) {
    console.error('[Sessions] revoke-others failed:', error);
    return NextResponse.json({ error: 'Failed to revoke sessions' }, { status: 500 });
  }
}

export const POST = withApiLogging(postHandler, 'api/sessions/revoke-others');
