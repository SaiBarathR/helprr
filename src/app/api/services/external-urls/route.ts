import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { SERVICE_VIEW_CAPABILITY } from '@/lib/server/service-capabilities';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const connections = await prisma.serviceConnection.findMany({
      where: { externalUrl: { not: null } },
      orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
      select: { id: true, type: true, externalUrl: true },
    });

    const canAdministerInstances = can(auth.user, 'settings.instances');
    const visible = connections.filter(
      (connection) => canAdministerInstances || can(auth.user, SERVICE_VIEW_CAPABILITY[connection.type]),
    );

    return NextResponse.json(visible, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Vary': 'Cookie',
      },
    }); // [{ id, type, externalUrl }], default instance first per type
  } catch (error) {
    console.error('Failed to fetch external URLs:', error);
    return NextResponse.json({ error: 'Failed to fetch external URLs' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/services/external-urls');
