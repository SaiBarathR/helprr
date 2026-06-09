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
      orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
      select: { id: true, type: true, externalUrl: true },
    });

    return NextResponse.json(connections); // [{ id, type, externalUrl }], default instance first per type
  } catch (error) {
    console.error('Failed to fetch external URLs:', error);
    return NextResponse.json({ error: 'Failed to fetch external URLs' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/services/external-urls');
