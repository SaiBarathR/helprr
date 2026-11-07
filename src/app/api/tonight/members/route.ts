import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { canJoinTonight } from '@/lib/tonight-pick';
import type { TonightMember } from '@/types/tonight';

// Who the viewer can invite to a Tonight pick: other active people who can use
// Random and view movies or series. Display names only.
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('random.view');
  if (!auth.ok) return auth.response;

  const users = await prisma.user.findMany({
    where: { status: 'active', id: { not: auth.user.id } },
    select: { id: true, displayName: true, role: true, template: true, permissions: true, status: true },
    orderBy: { displayName: 'asc' },
  });
  const members: TonightMember[] = users
    .filter((u) => canJoinTonight(u, 'any'))
    .map((u) => ({ id: u.id, name: u.displayName }));
  return NextResponse.json({ members });
}

export const GET = withApiLogging(getHandler, 'api/tonight/members');
