import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!can(auth.user, 'watchlist.view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Per-user: a user only sees their own tags (and their own item counts).
  const tags = await prisma.watchlistTag.findMany({
    where: { userId: auth.user.id },
    orderBy: { name: 'asc' },
    include: { _count: { select: { items: true } } },
  });

  return NextResponse.json(
    tags.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      count: t._count.items,
    }))
  );
}

export const GET = withApiLogging(getHandler, 'api/watchlist/tags');
