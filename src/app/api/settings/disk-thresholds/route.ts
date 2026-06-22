import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import {
  getAggregatedDiskSpace,
  diskId,
  parseDiskThresholds,
  type DiskThreshold,
} from '@/lib/disk-space';

// The current deduped disk list, annotated with its canonical id so the UI can
// render a row per live disk and match it to a saved threshold by diskId.
async function currentDisks() {
  try {
    return (await getAggregatedDiskSpace()).map((d) => ({
      diskId: diskId(d),
      label: d.label,
      path: d.path,
      freeSpace: d.freeSpace,
      totalSpace: d.totalSpace,
    }));
  } catch {
    return [];
  }
}

async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('settings.storage');
  if (capError) return capError;

  const settings = await getOrCreateAppSettings();
  const [thresholds, disks] = await Promise.all([
    Promise.resolve(parseDiskThresholds(settings.diskThresholds)),
    currentDisks(),
  ]);
  return NextResponse.json({ thresholds, disks });
}

async function putHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('settings.storage');
  if (capError) return capError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const incoming =
    body && typeof body === 'object' && Array.isArray((body as { thresholds?: unknown }).thresholds)
      ? (body as { thresholds: unknown[] })
      : null;
  if (!incoming) {
    return NextResponse.json({ error: 'Expected { thresholds: [...] }' }, { status: 400 });
  }

  // Strict validation — reject malformed input rather than silently dropping it.
  const byId = new Map<string, DiskThreshold>();
  for (const entry of incoming.thresholds) {
    if (!entry || typeof entry !== 'object') {
      return NextResponse.json({ error: 'Each threshold must be an object' }, { status: 400 });
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.diskId !== 'string' || !e.diskId.trim()) {
      return NextResponse.json({ error: 'Each threshold needs a non-empty diskId' }, { status: 400 });
    }
    if (typeof e.minFreeGb !== 'number' || !Number.isFinite(e.minFreeGb) || e.minFreeGb < 0) {
      return NextResponse.json({ error: 'minFreeGb must be a finite number >= 0' }, { status: 400 });
    }
    if (typeof e.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }
    // Normalize to the trimmed value validated above so the stored diskId
    // matches the canonical live-disk id at lookup time (and dedups correctly).
    const id = e.diskId.trim();
    // Last entry wins per disk, so a duplicate diskId can't double-alert.
    byId.set(id, {
      diskId: id,
      label: typeof e.label === 'string' ? e.label : '',
      path: typeof e.path === 'string' ? e.path : '',
      minFreeGb: e.minFreeGb,
      enabled: e.enabled,
    });
  }

  const persisted = [...byId.values()] as unknown as Prisma.InputJsonValue;
  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: { diskThresholds: persisted },
    create: { id: 'singleton', diskThresholds: persisted },
  });

  return NextResponse.json({ thresholds: [...byId.values()] });
}

export const GET = withApiLogging(getHandler, 'api/settings/disk-thresholds');
export const PUT = withApiLogging(putHandler, 'api/settings/disk-thresholds');
