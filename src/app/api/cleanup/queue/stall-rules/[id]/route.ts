import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { validateStallRulePayload } from '../../_validators';

async function putHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const err = await requireAuth();
  if (err) return err;
  const { id } = await ctx.params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const v = validateStallRulePayload(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const updated = await prisma.stallRule.update({
    where: { id },
    data: {
      ...v.value,
      minimumProgressBytes: v.value.minimumProgressBytes != null ? BigInt(v.value.minimumProgressBytes) : null,
    },
  });
  return NextResponse.json({
    ...updated,
    minimumProgressBytes: updated.minimumProgressBytes != null ? Number(updated.minimumProgressBytes) : null,
  });
}

async function deleteHandler(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const err = await requireAuth();
  if (err) return err;
  const { id } = await ctx.params;
  await prisma.stallRule.delete({ where: { id } });
  await prisma.cleanupStrike.deleteMany({ where: { ruleId: id, strikeType: 'stall' } });
  return NextResponse.json({ ok: true });
}

export const PUT = withApiLogging(putHandler, 'api/cleanup/queue/stall-rules/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/cleanup/queue/stall-rules/[id]');
