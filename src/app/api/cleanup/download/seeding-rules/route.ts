import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { validateSeedingRulePayload } from './_validator';
import { disableGlobalIfRuleClaimsConfirmationTx } from './_mutual-exclusion';
import { restartDownloadCleaner } from '@/lib/cleanup/scheduler';

function serialize<T extends { categories: unknown; trackerPatterns: unknown; tagsAny: unknown; tagsAll: unknown }>(r: T): T {
  return {
    ...r,
    categories: Array.isArray(r.categories) ? (r.categories as string[]) : [],
    trackerPatterns: Array.isArray(r.trackerPatterns) ? (r.trackerPatterns as string[]) : [],
    tagsAny: Array.isArray(r.tagsAny) ? (r.tagsAny as string[]) : [],
    tagsAll: Array.isArray(r.tagsAll) ? (r.tagsAll as string[]) : [],
  };
}

async function getHandler() {
  const err = await requireAuth();
  if (err) return err;
  const capError = await requireCapability('cleanup.view');
  if (capError) return capError;
  // Hide system rules — these are managed via the "Auto-remove imported"
  // toggle in the Download Cleaner config and showing them as a disabled
  // row in the user-editable list was confusing.
  const rows = await prisma.seedingRule.findMany({
    where: { isSystem: false },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });
  return NextResponse.json(rows.map(serialize));
}

async function postHandler(req: NextRequest) {
  const err = await requireAuth();
  if (err) return err;
  const capError = await requireCapability('cleanup.manage');
  if (capError) return capError;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const v = validateSeedingRulePayload(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  // Create the rule and apply the mutual-exclusion global flip in a single
  // transaction so a failure in the second step rolls the rule back rather
  // than leaving a rule-level rule enabled with the global still on.
  const { created, globalAutoRemoveDisabled } = await prisma.$transaction(async (tx) => {
    const row = await tx.seedingRule.create({
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
        isSystem: false,
      },
    });
    const flipped = await disableGlobalIfRuleClaimsConfirmationTx(tx, v.value);
    return { created: row, globalAutoRemoveDisabled: flipped };
  });
  if (globalAutoRemoveDisabled) await restartDownloadCleaner();
  return NextResponse.json({ ...serialize(created), globalAutoRemoveDisabled });
}

export const GET = withApiLogging(getHandler, 'api/cleanup/download/seeding-rules');
export const POST = withApiLogging(postHandler, 'api/cleanup/download/seeding-rules');
