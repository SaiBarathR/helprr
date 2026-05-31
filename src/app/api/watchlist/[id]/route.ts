import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { ensureTagIds, watchlistHrefFor } from '@/lib/watchlist-helpers';

function isNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025';
}

async function deleteHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireUserCapability('watchlist.edit');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  try {
    // Scope by owner so a member can't delete another user's item by guessing its id.
    const result = await prisma.watchlistItem.deleteMany({ where: { id, userId: auth.user.id } });
    if (result.count === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Watchlist] delete failed:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function patchHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireUserCapability('watchlist.edit');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  // Confirm the item belongs to the caller before mutating it.
  const owned = await prisma.watchlistItem.findFirst({
    where: { id, userId: auth.user.id },
    select: { id: true },
  });
  if (!owned) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  let body: { title?: unknown; tags?: unknown };
  try {
    body = (await request.json()) as { title?: unknown; tags?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data: { title?: string; tags?: { set: { id: string }[] } } = {};
  if (typeof body.title === 'string' && body.title.trim()) {
    data.title = body.title.trim();
  }
  if (Array.isArray(body.tags)) {
    const tagIds = await ensureTagIds(
      auth.user.id,
      body.tags.filter((t): t is string => typeof t === 'string')
    );
    data.tags = { set: tagIds.map((tid) => ({ id: tid })) };
  }

  try {
    const item = await prisma.watchlistItem.update({
      where: { id },
      data,
      include: { tags: true },
    });
    return NextResponse.json({
      ...item,
      addedAt: item.addedAt.toISOString(),
      href: watchlistHrefFor(item.source, item.externalId, item.mediaType),
    });
  } catch (err) {
    if (isNotFound(err)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    console.error('[Watchlist] patch failed:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export const DELETE = withApiLogging(deleteHandler, 'api/watchlist/[id]');
export const PATCH = withApiLogging(patchHandler, 'api/watchlist/[id]');
