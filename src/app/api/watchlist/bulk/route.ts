import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { ensureTagIds, lookupTagIds } from '@/lib/watchlist-helpers';

type ApplyTags = 'add' | 'remove' | 'replace';

const BULK_CHUNK_SIZE = 50;

function parseTagNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const labels: string[] = [];
  for (const t of value) {
    if (typeof t !== 'string' || !t.trim()) return null;
    labels.push(t.trim());
  }
  return labels;
}

function parseIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== 'string' || !id.trim()) return null;
    ids.push(id.trim());
  }
  return ids;
}

function parseBody(
  body: unknown
): { ids: string[]; tags: string[]; applyTags: ApplyTags } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid body' };
  const b = body as Record<string, unknown>;

  const ids = parseIds(b.ids);
  if (!ids) return { error: 'ids must be a non-empty array of strings' };

  const tags = parseTagNames(b.tags);
  if (!tags) return { error: 'tags must be a non-empty array of strings' };

  if (b.applyTags !== 'add' && b.applyTags !== 'remove' && b.applyTags !== 'replace') {
    return { error: "applyTags must be 'add', 'remove', or 'replace'" };
  }

  return { ids, tags, applyTags: b.applyTags };
}

function tagUpdateData(
  applyTags: ApplyTags,
  tagConnect: { id: string }[]
): Prisma.WatchlistItemUpdateInput {
  if (applyTags === 'add') return { tags: { connect: tagConnect } };
  if (applyTags === 'remove') return { tags: { disconnect: tagConnect } };
  return { tags: { set: tagConnect } };
}

async function patchHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('watchlist.edit');
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = parseBody(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { ids, tags, applyTags } = parsed;
  const userId = auth.user.id;

  const owned = await prisma.watchlistItem.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((i) => i.id));
  const fail = ids.filter((id) => !ownedIds.has(id)).length;

  if (ownedIds.size === 0) {
    return NextResponse.json({ ok: 0, fail: ids.length });
  }

  const tagIds =
    applyTags === 'remove'
      ? await lookupTagIds(userId, tags)
      : await ensureTagIds(userId, tags);

  if (tagIds.length === 0) {
    if (applyTags === 'remove') {
      return NextResponse.json({ ok: ownedIds.size, fail });
    }
    return NextResponse.json({ ok: 0, fail: ids.length });
  }

  const tagConnect = tagIds.map((id) => ({ id }));
  const updateData = tagUpdateData(applyTags, tagConnect);
  const ownedIdList = [...ownedIds];

  let ok = 0;
  let opFail = fail;

  for (let i = 0; i < ownedIdList.length; i += BULK_CHUNK_SIZE) {
    const chunk = ownedIdList.slice(i, i + BULK_CHUNK_SIZE);
    try {
      await prisma.$transaction(
        chunk.map((id) => prisma.watchlistItem.update({ where: { id }, data: updateData }))
      );
      ok += chunk.length;
    } catch (err) {
      console.error('[Watchlist] bulk tag chunk failed:', err);
      opFail += chunk.length;
    }
  }

  return NextResponse.json({ ok, fail: opFail });
}

async function deleteHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('watchlist.edit');
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const ids = parseIds((body as Record<string, unknown>).ids);
  if (!ids) {
    return NextResponse.json({ error: 'ids must be a non-empty array of strings' }, { status: 400 });
  }

  // Scope by owner so a member can't delete another user's items by guessing ids.
  const result = await prisma.watchlistItem.deleteMany({
    where: { userId: auth.user.id, id: { in: ids } },
  });

  return NextResponse.json({ ok: result.count, fail: ids.length - result.count });
}

export const PATCH = withApiLogging(patchHandler, 'api/watchlist/bulk', { logBodies: false });
export const DELETE = withApiLogging(deleteHandler, 'api/watchlist/bulk', { logBodies: false });
