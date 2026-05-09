import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const connections = await prisma.serviceConnection.findMany({
      where: { externalUrl: { not: null } },
      select: { type: true, externalUrl: true },
    });

    const result: Record<string, string> = {};
    for (const conn of connections) {
      if (conn.externalUrl) {
        result[conn.type] = conn.externalUrl;
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to fetch external URLs:', error);
    return NextResponse.json({ error: 'Failed to fetch external URLs' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/services/external-urls');
