import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { normalizeTagName } from '@/lib/watchlist-helpers';

async function patchHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireUserCapability('watchlist.edit');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  let body: { name?: unknown; color?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; color?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data: { name?: string; color?: string | null } = {};
  if (typeof body.name === 'string') {
    const next = normalizeTagName(body.name);
    if (!next) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    if (next.length > 50) return NextResponse.json({ error: 'name too long' }, { status: 400 });
    data.name = next;
  }
  if (body.color === null) {
    data.color = null;
  } else if (typeof body.color === 'string') {
    const c = body.color.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(c)) {
      return NextResponse.json({ error: 'color must be #RRGGBB' }, { status: 400 });
    }
    data.color = c;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'no changes' }, { status: 400 });
  }

  // Confirm the tag belongs to the caller before mutating it.
  const owned = await prisma.watchlistTag.findFirst({
    where: { id, userId: auth.user.id },
    select: { id: true },
  });
  if (!owned) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
  }

  try {
    const tag = await prisma.watchlistTag.update({
      where: { id },
      data,
      include: { _count: { select: { items: true } } },
    });
    return NextResponse.json({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      count: tag._count.items,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') {
        return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
      }
      if (err.code === 'P2002') {
        return NextResponse.json({ error: 'Name already in use' }, { status: 409 });
      }
    }
    console.error('[WatchlistTag] patch failed:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function deleteHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireUserCapability('watchlist.edit');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    // Scope to the caller so a member can't delete another user's tag by id.
    const result = await prisma.watchlistTag.deleteMany({ where: { id, userId: auth.user.id } });
    if (result.count === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[WatchlistTag] delete failed:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export const PATCH = withApiLogging(patchHandler, 'api/watchlist/tags/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/watchlist/tags/[id]');
