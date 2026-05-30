import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function postHandler(req: NextRequest) {
  const err = await requireAuth();
  if (err) return err;
  const capError = await requireCapability('cleanup.manage');
  if (capError) return capError;
  let body: { orderedIds?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const orderedIds = Array.isArray(body.orderedIds) ? (body.orderedIds as unknown[]).map(String) : null;
  if (!orderedIds) return NextResponse.json({ error: 'orderedIds required' }, { status: 400 });
  if (orderedIds.length === 0) return NextResponse.json({ ok: true });

  // Validate that every supplied ID exists, and reject duplicates. Without
  // this, a stale client (e.g. a rule was deleted in another tab) causes
  // Prisma to throw on the missing row and the whole transaction rolls back
  // with an opaque 500.
  const existing = await prisma.seedingRule.findMany({
    where: { id: { in: orderedIds } },
    select: { id: true, isSystem: true },
  });
  const knownIds = new Set(existing.map((r) => r.id));
  const unknown = orderedIds.filter((id) => !knownIds.has(id));
  if (unknown.length > 0) {
    return NextResponse.json({ error: 'unknown rule IDs', unknownIds: unknown }, { status: 400 });
  }
  const systemIds = existing.filter((r) => r.isSystem).map((r) => r.id);
  if (systemIds.length > 0) {
    return NextResponse.json({ error: 'system seeding rules cannot be reordered', systemIds }, { status: 400 });
  }
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (seen.has(id)) return NextResponse.json({ error: 'duplicate rule IDs in payload' }, { status: 400 });
    seen.add(id);
  }

  await prisma.$transaction(
    orderedIds.map((id, idx) => prisma.seedingRule.update({ where: { id }, data: { priority: idx } })),
  );
  return NextResponse.json({ ok: true });
}

export const POST = withApiLogging(postHandler, 'api/cleanup/download/seeding-rules/reorder');
