import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { validateStallRulePayload } from '../_validators';

async function getHandler() {
  const err = await requireAuth();
  if (err) return err;
  const rows = await prisma.stallRule.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
  return NextResponse.json(rows.map((r) => ({
    ...r,
    minimumProgressBytes: r.minimumProgressBytes != null ? Number(r.minimumProgressBytes) : null,
  })));
}

async function postHandler(req: NextRequest) {
  const err = await requireAuth();
  if (err) return err;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const v = validateStallRulePayload(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const created = await prisma.stallRule.create({
    data: {
      ...v.value,
      minimumProgressBytes: v.value.minimumProgressBytes != null ? BigInt(v.value.minimumProgressBytes) : null,
    },
  });
  return NextResponse.json({
    ...created,
    minimumProgressBytes: created.minimumProgressBytes != null ? Number(created.minimumProgressBytes) : null,
  });
}

export const GET = withApiLogging(getHandler, 'api/cleanup/queue/stall-rules');
export const POST = withApiLogging(postHandler, 'api/cleanup/queue/stall-rules');
