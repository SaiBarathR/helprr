import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { validateSlowRulePayload } from '../../_validators';

async function putHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const err = await requireAuth();
  if (err) return err;
  const { id } = await ctx.params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const v = validateSlowRulePayload(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const updated = await prisma.slowRule.update({
    where: { id },
    data: {
      ...v.value,
      ignoreAboveSizeBytes: v.value.ignoreAboveSizeBytes != null ? BigInt(v.value.ignoreAboveSizeBytes) : null,
    },
  });
  return NextResponse.json({
    ...updated,
    ignoreAboveSizeBytes: updated.ignoreAboveSizeBytes != null ? Number(updated.ignoreAboveSizeBytes) : null,
  });
}

async function deleteHandler(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const err = await requireAuth();
  if (err) return err;
  const { id } = await ctx.params;
  await prisma.slowRule.delete({ where: { id } });
  await prisma.cleanupStrike.deleteMany({ where: { ruleId: id, strikeType: 'slow' } });
  return NextResponse.json({ ok: true });
}

export const PUT = withApiLogging(putHandler, 'api/cleanup/queue/slow-rules/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/cleanup/queue/slow-rules/[id]');
