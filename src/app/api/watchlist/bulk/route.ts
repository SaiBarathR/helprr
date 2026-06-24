import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { ensureTagIds, normalizeTagName } from '@/lib/watchlist-helpers';

type ApplyTags = 'add' | 'remove' | 'replace';

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

async function resolveExistingTagIds(userId: string, rawNames: string[]): Promise<string[]> {
  const cleaned = Array.from(
    new Set(
      rawNames
        .map((t) => normalizeTagName(t))
        .filter((t) => t.length > 0 && t.length <= 50)
    )
  );
  if (cleaned.length === 0) return [];

  const existing = await prisma.watchlistTag.findMany({
    where: { userId, name: { in: cleaned } },
    select: { id: true, name: true },
  });
  const byName = new Map(existing.map((t) => [t.name, t.id]));
  return cleaned.map((n) => byName.get(n)).filter((id): id is string => Boolean(id));
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
      ? await resolveExistingTagIds(userId, tags)
      : await ensureTagIds(userId, tags);

  if (tagIds.length === 0) {
    return NextResponse.json({ ok: 0, fail: ids.length });
  }

  const tagConnect = tagIds.map((id) => ({ id }));

  try {
    await prisma.$transaction(
      [...ownedIds].map((id) => {
        if (applyTags === 'add') {
          return prisma.watchlistItem.update({
            where: { id },
            data: { tags: { connect: tagConnect } },
          });
        }
        if (applyTags === 'remove') {
          return prisma.watchlistItem.update({
            where: { id },
            data: { tags: { disconnect: tagConnect } },
          });
        }
        return prisma.watchlistItem.update({
          where: { id },
          data: { tags: { set: tagConnect } },
        });
      })
    );
  } catch (err) {
    console.error('[Watchlist] bulk tag update failed:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  return NextResponse.json({ ok: ownedIds.size, fail });
}

export const PATCH = withApiLogging(patchHandler, 'api/watchlist/bulk');
