import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, SESSION_DURATION } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  // Sessions older than the JWT lifetime carry a token the server will
  // refuse anyway — don't show them in the active-devices list.
  const cutoff = new Date(Date.now() - SESSION_DURATION * 1000);

  try {
    const rows = await prisma.session.findMany({
      where: { revokedAt: null, createdAt: { gte: cutoff } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        userAgent: true,
        ip: true,
        label: true,
      },
    });
    const currentSid = auth.session.id;
    return NextResponse.json(
      rows.map((row) => ({ ...row, isCurrent: row.id === currentSid }))
    );
  } catch (error) {
    console.error('[Sessions] list failed:', error);
    return NextResponse.json({ error: 'Failed to list sessions' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/sessions');
