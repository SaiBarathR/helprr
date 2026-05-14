import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function postHandler(req: NextRequest) {
  const err = await requireAuth();
  if (err) return err;
  let body: { orderedIds?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const orderedIds = Array.isArray(body.orderedIds) ? (body.orderedIds as unknown[]).map(String) : null;
  if (!orderedIds) return NextResponse.json({ error: 'orderedIds required' }, { status: 400 });
  await prisma.$transaction(
    orderedIds.map((id, idx) => prisma.seedingRule.update({ where: { id }, data: { priority: idx } })),
  );
  return NextResponse.json({ ok: true });
}

export const POST = withApiLogging(postHandler, 'api/cleanup/download/seeding-rules/reorder');
