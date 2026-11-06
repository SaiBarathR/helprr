import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser, SESSION_DURATION } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { parseSkipTake } from '@/lib/pagination';
import { SESSION_IDLE_TIMEOUT_SECONDS } from '@/lib/session-policy';

// Sessions shown per person before "Show more".
const SESSIONS_PAGE_SIZE = 10;

const SESSION_SELECT = {
  id: true,
  createdAt: true,
  lastSeenAt: true,
  userAgent: true,
  ip: true,
  label: true,
} satisfies Prisma.SessionSelect;

type SessionFields = Prisma.SessionGetPayload<{ select: typeof SESSION_SELECT }>;

// Live devices: unrevoked, inside the fixed JWT lifetime and inside the idle
// window. (A disabled user's rows also fail auth, but disabling revokes them.)
function activeWhere(nowMs: number): Prisma.SessionWhereInput {
  return {
    revokedAt: null,
    createdAt: { gte: new Date(nowMs - SESSION_DURATION * 1000) },
    lastSeenAt: { gte: new Date(nowMs - SESSION_IDLE_TIMEOUT_SECONDS * 1000) },
  };
}

function toDto(row: SessionFields, currentSid: string) {
  return {
    id: row.id,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    userAgent: row.userAgent,
    ip: row.ip,
    label: row.label,
    isCurrent: row.id === currentSid,
  };
}

// One person's sessions, newest sign-in first. The viewer's own list starts
// with the session making this request, so "this device" is always on top.
async function sessionPage(
  where: Prisma.SessionWhereInput,
  userId: string,
  total: number,
  current: SessionFields | null,
  skip: number,
  take: number,
) {
  const pinned = current && skip === 0 ? [current] : [];
  const rows = await prisma.session.findMany({
    where: { ...where, userId, ...(current ? { NOT: { id: current.id } } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: current ? Math.max(0, skip - 1) : skip,
    take: take - pinned.length,
    select: SESSION_SELECT,
  });
  const sessions = [...pinned, ...rows];
  const currentSid = current?.id ?? '';
  return {
    total,
    sessions: sessions.map((row) => toDto(row, currentSid)),
    hasMore: skip + sessions.length < total,
  };
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const isAdmin = auth.user.role === 'admin';
  const where = activeWhere(Date.now());
  const current: SessionFields = auth.session;
  const sp = request.nextUrl.searchParams;
  const userId = sp.get('userId');

  try {
    // "Show more" for one person's group.
    if (userId !== null) {
      // Members may only page their own sessions; report anyone else as 404
      // so the endpoint can't be used to probe which user ids exist.
      if (!isAdmin && userId !== auth.user.id) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      const { skip, take } = parseSkipTake(sp, { defaultTake: SESSIONS_PAGE_SIZE, maxTake: 50 });
      const isOwn = userId === auth.user.id;
      const total = await prisma.session.count({ where: { ...where, userId } });
      return NextResponse.json(
        await sessionPage(where, userId, total, isOwn ? current : null, skip, take)
      );
    }

    // Members see only their own devices; admins see everyone's, one group per
    // person, so they can audit and force-logout a household member.
    const users = await prisma.user.findMany({
      where: isAdmin ? { sessions: { some: where } } : { id: auth.user.id },
      select: {
        id: true,
        displayName: true,
        _count: { select: { sessions: { where } } },
      },
    });
    users.sort((a, b) =>
      a.id === auth.user.id ? -1 : b.id === auth.user.id ? 1 : a.displayName.localeCompare(b.displayName)
    );
    const groups = await Promise.all(
      users.map(async (user) => {
        const isOwn = user.id === auth.user.id;
        const page = await sessionPage(
          where,
          user.id,
          user._count.sessions,
          isOwn ? current : null,
          0,
          SESSIONS_PAGE_SIZE,
        );
        return { userId: user.id, ownerName: user.displayName, isOwn, ...page };
      })
    );
    return NextResponse.json({ groups });
  } catch (error) {
    console.error('[Sessions] list failed:', error);
    return NextResponse.json({ error: 'Failed to list sessions' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/sessions');
