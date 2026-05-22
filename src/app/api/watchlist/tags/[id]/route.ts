import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { normalizeTagName } from '@/lib/watchlist-helpers';

async function patchHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

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
  } catch {
    return NextResponse.json({ error: 'Tag not found or name conflict' }, { status: 409 });
  }
}

async function deleteHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const { id } = await params;
  try {
    await prisma.watchlistTag.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}

export const PATCH = withApiLogging(patchHandler, 'api/watchlist/tags/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/watchlist/tags/[id]');
