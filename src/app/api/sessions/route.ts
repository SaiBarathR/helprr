import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser, SESSION_DURATION } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  // Sessions older than the JWT lifetime carry a token the server will
  // refuse anyway — don't show them in the active-devices list.
  const cutoff = new Date(Date.now() - SESSION_DURATION * 1000);

  const isAdmin = auth.user.role === 'admin';

  try {
    const rows = await prisma.session.findMany({
      // Members see only their own devices; admins see everyone's (with owner
      // labels) so they can audit and force-logout a household member.
      where: {
        revokedAt: null,
        createdAt: { gte: cutoff },
        ...(isAdmin ? {} : { userId: auth.user.id }),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        userAgent: true,
        ip: true,
        label: true,
        userId: true,
        user: { select: { displayName: true } },
      },
    });
    const currentSid = auth.session.id;
    return NextResponse.json(
      rows.map((row) => {
        const isOwn = row.userId === auth.user.id;
        return {
          id: row.id,
          createdAt: row.createdAt,
          lastSeenAt: row.lastSeenAt,
          userAgent: row.userAgent,
          ip: row.ip,
          label: row.label,
          isCurrent: row.id === currentSid,
          isOwn,
          // Only surface a name for *other* users' sessions (admin view); never
          // label the viewer's own rows.
          ownerName: isOwn ? null : row.user?.displayName ?? null,
        };
      })
    );
  } catch (error) {
    console.error('[Sessions] list failed:', error);
    return NextResponse.json({ error: 'Failed to list sessions' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/sessions');
