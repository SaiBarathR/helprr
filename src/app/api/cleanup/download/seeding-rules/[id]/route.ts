import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { validateSeedingRulePayload } from '../_validator';
import { disableGlobalIfRuleClaimsConfirmation } from '../_mutual-exclusion';

async function putHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const err = await requireAuth();
  if (err) return err;
  const { id } = await ctx.params;

  const existing = await prisma.seedingRule.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.isSystem) {
    return NextResponse.json({ error: 'system seeding rule cannot be edited directly. Update Download Cleaner config instead.' }, { status: 400 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const v = validateSeedingRulePayload(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const updated = await prisma.seedingRule.update({
    where: { id },
    data: {
      name: v.value.name,
      enabled: v.value.enabled,
      priority: v.value.priority,
      categories: v.value.categories,
      trackerPatterns: v.value.trackerPatterns,
      tagsAny: v.value.tagsAny,
      tagsAll: v.value.tagsAll,
      privacyType: v.value.privacyType,
      maxRatio: v.value.maxRatio,
      minSeedTimeHours: v.value.minSeedTimeHours,
      maxSeedTimeHours: v.value.maxSeedTimeHours,
      deleteSourceFiles: v.value.deleteSourceFiles,
      requireImportedConfirmation: v.value.requireImportedConfirmation,
    },
  });
  const globalAutoRemoveDisabled = await disableGlobalIfRuleClaimsConfirmation(v.value);
  return NextResponse.json({ ...updated, globalAutoRemoveDisabled });
}

async function deleteHandler(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const err = await requireAuth();
  if (err) return err;
  const { id } = await ctx.params;
  const existing = await prisma.seedingRule.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.isSystem) {
    return NextResponse.json({ error: 'system seeding rule cannot be deleted. Disable autoRemoveImportedEnabled instead.' }, { status: 400 });
  }
  await prisma.seedingRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export const PUT = withApiLogging(putHandler, 'api/cleanup/download/seeding-rules/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/cleanup/download/seeding-rules/[id]');
