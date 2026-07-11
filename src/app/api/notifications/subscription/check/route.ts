import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  // Deliberately NOT capability-gated (same policy as /api/push/subscribe):
  // the app-wide push hook calls this on every load to reconcile the browser's
  // subscription with the server, and that must keep working for users denied
  // the notification settings page.

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
    return upstreamErrorResponse(error, 'Failed');
  }
}

export const POST = withApiLogging(postHandler, 'api/notifications/subscription/check');
