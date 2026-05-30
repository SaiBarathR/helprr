import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { effectiveCapabilities } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';

// Returns the current user's identity + fully-resolved capability map. The client
// permission provider uses this for UX gating only — the real boundary is the
// per-route requireCapability checks.
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const u = auth.user;
  const seerrConfigured = (await prisma.serviceConnection.count({ where: { type: 'SEERR' } })) > 0;
  return NextResponse.json({
    id: u.id,
    name: u.displayName,
    username: u.username,
    role: u.role,
    template: u.template,
    capabilities: effectiveCapabilities(u),
    seerrConfigured,
    seerrUserId: u.seerrUserId,
  });
}

export const GET = withApiLogging(getHandler, 'api/me');
