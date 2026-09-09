import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { validateSlowRulePayload } from '../_validators';

async function getHandler() {
  const auth = await requireUserCapability('cleanup.view');
  if (!auth.ok) return auth.response;
  const rows = await prisma.slowRule.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
  return NextResponse.json(rows.map((r) => ({
    ...r,
    ignoreAboveSizeBytes: r.ignoreAboveSizeBytes != null ? Number(r.ignoreAboveSizeBytes) : null,
  })));
}

async function postHandler(req: NextRequest) {
  const auth = await requireUserCapability('cleanup.manage');
  if (!auth.ok) return auth.response;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const v = validateSlowRulePayload(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const created = await prisma.slowRule.create({
    data: {
      ...v.value,
      ignoreAboveSizeBytes: v.value.ignoreAboveSizeBytes != null ? BigInt(v.value.ignoreAboveSizeBytes) : null,
    },
  });
  return NextResponse.json({
    ...created,
    ignoreAboveSizeBytes: created.ignoreAboveSizeBytes != null ? Number(created.ignoreAboveSizeBytes) : null,
  });
}

export const GET = withApiLogging(getHandler, 'api/cleanup/queue/slow-rules');
export const POST = withApiLogging(postHandler, 'api/cleanup/queue/slow-rules');
