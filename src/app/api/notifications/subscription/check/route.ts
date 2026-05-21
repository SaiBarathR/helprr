import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { withApiLogging } from '@/lib/api-logger';

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const endpoint = (body as { endpoint?: unknown }).endpoint;
    if (typeof endpoint !== 'string' || !endpoint.trim()) {
      return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
    }
    const row = await prisma.pushSubscription.findUnique({
      where: { endpoint },
      select: { id: true, revokedAt: true },
    });
    if (!row) return NextResponse.json({ exists: false });
    if (row.revokedAt) return NextResponse.json({ exists: false, revoked: true });
    return NextResponse.json({ exists: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(postHandler, 'api/notifications/subscription/check');
