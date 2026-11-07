import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { recordSecurityEvent } from '@/lib/security-audit';

/** Turn one of your own API tokens off; it is refused from the next request. Someone else's answers 404. */
async function deleteHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const token = await prisma.apiToken.findFirst({ where: { id, userId: auth.user.id }, select: { name: true } });
    const result = await prisma.apiToken.deleteMany({ where: { id, userId: auth.user.id } });
    if (!token || result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await recordSecurityEvent(request, {
      actor: auth.user,
      action: 'API_TOKEN_REVOKED',
      targetType: 'api-token',
      targetId: id,
      targetLabel: token.name,
    });
    return NextResponse.json({ revoked: true });
  } catch (error) {
    console.error(`[ApiToken] Failed to turn off a token: ${error instanceof Error ? error.name : 'unknown error'}`);
    return NextResponse.json({ error: 'Failed to turn off the API token' }, { status: 500 });
  }
}

export const DELETE = withApiLogging(deleteHandler, 'api/me/api-tokens/[id]', { logBodies: false });
