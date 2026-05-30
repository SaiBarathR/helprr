import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('watchlist.view');
  if (capError) return capError;

  const tags = await prisma.watchlistTag.findMany({
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
