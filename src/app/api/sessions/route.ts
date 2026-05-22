import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  try {
    const rows = await prisma.session.findMany({
      where: { revokedAt: null },
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/sessions');
