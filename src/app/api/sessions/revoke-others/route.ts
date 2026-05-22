import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function postHandler(): Promise<NextResponse> {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  try {
    const result = await prisma.session.updateMany({
      where: {
        revokedAt: null,
        NOT: { id: auth.session.id },
      },
      data: { revokedAt: new Date() },
    });
    return NextResponse.json({ revoked: result.count });
  } catch (error) {
    console.error('[Sessions] revoke-others failed:', error);
    return NextResponse.json({ error: 'Failed to revoke sessions' }, { status: 500 });
  }
}

export const POST = withApiLogging(postHandler, 'api/sessions/revoke-others');
