import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { normalizeTagName, pickTagColor, watchlistHrefFor } from '@/lib/watchlist-helpers';

async function ensureTagIds(rawNames: string[]): Promise<string[]> {
  const cleaned = Array.from(
    new Set(
      rawNames
        .map((t) => normalizeTagName(t))
        .filter((t) => t.length > 0 && t.length <= 50)
    )
  );
  if (cleaned.length === 0) return [];

  const existing = await prisma.watchlistTag.findMany({
    where: { name: { in: cleaned } },
    select: { id: true, name: true },
  });
  const map = new Map(existing.map((t) => [t.name, t.id]));
  const toCreate = cleaned.filter((n) => !map.has(n));
  if (toCreate.length > 0) {
    await prisma.watchlistTag.createMany({
      data: toCreate.map((name) => ({ name, color: pickTagColor(name) })),
      skipDuplicates: true,
    });
    const fresh = await prisma.watchlistTag.findMany({
      where: { name: { in: toCreate } },
      select: { id: true, name: true },
    });
    for (const t of fresh) map.set(t.name, t.id);
  }
  return cleaned.map((n) => map.get(n)!).filter(Boolean);
}

async function deleteHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  try {
    await prisma.watchlistItem.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}

async function patchHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
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
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}

export const DELETE = withApiLogging(deleteHandler, 'api/watchlist/[id]');
export const PATCH = withApiLogging(patchHandler, 'api/watchlist/[id]');
