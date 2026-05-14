import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { validateSeedingRulePayload } from './_validator';

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
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const v = validateSeedingRulePayload(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const created = await prisma.seedingRule.create({
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
      isSystem: false,
    },
  });
  return NextResponse.json(serialize(created));
}

export const GET = withApiLogging(getHandler, 'api/cleanup/download/seeding-rules');
export const POST = withApiLogging(postHandler, 'api/cleanup/download/seeding-rules');
