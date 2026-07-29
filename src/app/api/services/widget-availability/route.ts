import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { filterVisibleServiceTypes } from '@/lib/server/service-capabilities';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const connections = await prisma.serviceConnection.findMany({
    distinct: ['type'],
    select: { type: true },
  });
  const services = filterVisibleServiceTypes(
    auth.user,
    connections.map(({ type }) => type),
  );

  return NextResponse.json(
    { services },
    {
      headers: {
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
      },
    },
  );
}

export const GET = withApiLogging(getHandler, 'api/services/widget-availability');
