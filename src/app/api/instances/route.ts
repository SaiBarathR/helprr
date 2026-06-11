import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ARR_TYPES } from '@/lib/arr-instances';
import { withApiLogging } from '@/lib/api-logger';

// Member-safe list of arr instances — id/label/type/isDefault only, never URLs or
// API keys. Powers instance pickers (add flows) and filters (calendar/activity/
// history) for non-admins, who cannot read the admin-only /api/services.
async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const instances = await prisma.serviceConnection.findMany({
    where: { type: { in: ARR_TYPES } },
    select: { id: true, label: true, type: true, isDefault: true },
    orderBy: [{ type: 'asc' }, { isDefault: 'desc' }, { label: 'asc' }],
  });
  return NextResponse.json(instances);
}

export const GET = withApiLogging(getHandler, 'api/instances');
