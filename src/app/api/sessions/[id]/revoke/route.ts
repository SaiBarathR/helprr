import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { COOKIE_NAME, requireSession, revokeSession } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { isHttpsRequest } from '@/lib/request-utils';

async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const existing = await prisma.session.findUnique({
      where: { id },
      select: { id: true, revokedAt: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (existing.revokedAt) {
      return NextResponse.json({ revoked: 0 });
    }
    await revokeSession(id);
    const wasCurrent = id === auth.session.id;
    const response = NextResponse.json({ revoked: 1, wasCurrent });
    if (wasCurrent) {
      // Clear the cookie up-front so the next navigation doesn't even
      // hit the middleware-then-redirect round-trip.
      response.cookies.set(COOKIE_NAME, '', {
        httpOnly: true,
        secure: isHttpsRequest(request, process.env.TRUST_FORWARDED_PROTO === 'true'),
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
      });
    }
    return response;
  } catch (error) {
    console.error('[Sessions] revoke failed:', error);
    return NextResponse.json({ error: 'Failed to revoke session' }, { status: 500 });
  }
}

export const POST = withApiLogging(postHandler, 'api/sessions/[id]/revoke');
