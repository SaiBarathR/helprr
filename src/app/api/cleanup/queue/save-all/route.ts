import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import {
  loadQueueCleanerConfig,
  loadSlowRules,
  loadStallRules,
  saveQueueCleanerConfig,
} from '@/lib/cleanup/queue-cleaner';
import { restartQueueCleaner } from '@/lib/cleanup/scheduler';
import { capStrikesToThreshold } from '@/lib/cleanup/strikes';
import {
  AUTO_RUN_MODES,
  AutoRunMode,
  DEFAULT_FAILED_IMPORT,
  FailedImportConfig,
  QueueCleanerConfigShape,
  SlowRuleShape,
  StallRuleShape,
} from '@/lib/cleanup/types';
import { validateSlowRulePayload, validateStallRulePayload } from '../_validators';

type StallRuleInput = Omit<StallRuleShape, 'id'>;
type SlowRuleInput = Omit<SlowRuleShape, 'id'>;

interface FieldError {
  scope: 'config' | 'stall' | 'slow';
  id?: string;
  message: string;
}

function validateConfig(b: Record<string, unknown>): { ok: true; value: QueueCleanerConfigShape } | { ok: false; error: string } {
  const enabled = Boolean(b.enabled);
  const intervalMinutes = Number(b.intervalMinutes);
  // Upper bound keeps the scheduler delay far below the 32-bit setInterval
  // limit (~24.8 days), where Node would clamp to ~1ms and run continuously.
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 10080) {
    return { ok: false, error: 'intervalMinutes must be between 1 and 10080 (7 days)' };
  }
  const ignoredDownloads = Array.isArray(b.ignoredDownloads)
    ? (b.ignoredDownloads as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
    : [];
  const processNoContentId = Boolean(b.processNoContentId);
  const reSearchAfterRemoval = Boolean(b.reSearchAfterRemoval);
  const dmms = Number(b.downloadingMetadataMaxStrikes ?? 0);
  if (!Number.isFinite(dmms) || dmms < 0) return { ok: false, error: 'downloadingMetadataMaxStrikes must be >= 0' };
  if (dmms > 0 && dmms < 3) return { ok: false, error: 'downloadingMetadataMaxStrikes must be 0 or >= 3' };

  const fiRaw = (b.failedImport ?? {}) as Record<string, unknown>;
  const fi: FailedImportConfig = {
    ...DEFAULT_FAILED_IMPORT,
    ...(fiRaw as Partial<FailedImportConfig>),
  };
  fi.maxStrikes = Number(fiRaw.maxStrikes ?? 0);
  if (!Number.isFinite(fi.maxStrikes) || fi.maxStrikes < 0) return { ok: false, error: 'failedImport.maxStrikes must be >= 0' };
  if (fi.maxStrikes > 0 && fi.maxStrikes < 3) return { ok: false, error: 'failedImport.maxStrikes must be 0 or >= 3' };
  fi.patterns = Array.isArray(fiRaw.patterns) ? (fiRaw.patterns as unknown[]).map(String).map((s) => s.trim()).filter(Boolean) : [];
  fi.patternMode = fiRaw.patternMode === 'include' ? 'include' : 'exclude';
  fi.ignorePrivate = Boolean(fiRaw.ignorePrivate);
  fi.deletePrivate = Boolean(fiRaw.deletePrivate);
  fi.skipIfNotFoundInClient = fiRaw.skipIfNotFoundInClient === undefined ? true : Boolean(fiRaw.skipIfNotFoundInClient);
  fi.changeCategory = Boolean(fiRaw.changeCategory);
  if (fi.changeCategory && fi.deletePrivate) {
    return { ok: false, error: 'Failed import: cannot enable both deletePrivate and changeCategory' };
  }
  if (fi.maxStrikes >= 3 && fi.patternMode === 'include' && fi.patterns.length === 0) {
    return { ok: false, error: 'Failed import: at least one pattern required in include mode' };
  }

  const autoRunModeRaw = String(b.autoRunMode ?? 'disabled');
  if (!(AUTO_RUN_MODES as string[]).includes(autoRunModeRaw)) {
    return { ok: false, error: `autoRunMode must be one of: ${AUTO_RUN_MODES.join(', ')}` };
  }
  const autoRunMode = autoRunModeRaw as AutoRunMode;

  return {
    ok: true,
    value: {
      enabled,
      intervalMinutes: Math.floor(intervalMinutes),
      ignoredDownloads,
      processNoContentId,
      downloadingMetadataMaxStrikes: Math.floor(dmms),
      failedImport: fi,
      reSearchAfterRemoval,
      autoRunMode,
    },
  };
}

async function postHandler(req: NextRequest) {
  const err = await requireAuth();
  if (err) return err;
  const capError = await requireCapability('cleanup.manage');
  if (capError) return capError;
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const errors: FieldError[] = [];

  const cfgResult = validateConfig((body.config ?? {}) as Record<string, unknown>);
  if (!cfgResult.ok) errors.push({ scope: 'config', message: cfgResult.error });

  const stallRulesRaw = Array.isArray(body.stallRules) ? (body.stallRules as Record<string, unknown>[]) : [];
  const slowRulesRaw = Array.isArray(body.slowRules) ? (body.slowRules as Record<string, unknown>[]) : [];

  const stallValidated: { id: string; value: StallRuleInput }[] = [];
  const slowValidated: { id: string; value: SlowRuleInput }[] = [];

  for (const r of stallRulesRaw) {
    const id = typeof r.id === 'string' ? r.id : '';
    if (!id) { errors.push({ scope: 'stall', message: 'rule missing id' }); continue; }
    const v = validateStallRulePayload(r);
    if (!v.ok) errors.push({ scope: 'stall', id, message: v.error });
    else stallValidated.push({ id, value: v.value });
  }

  for (const r of slowRulesRaw) {
    const id = typeof r.id === 'string' ? r.id : '';
    if (!id) { errors.push({ scope: 'slow', message: 'rule missing id' }); continue; }
    const v = validateSlowRulePayload(r);
    if (!v.ok) errors.push({ scope: 'slow', id, message: v.error });
    else slowValidated.push({ id, value: v.value });
  }

  if (errors.length > 0 || !cfgResult.ok) {
    return NextResponse.json({ error: 'validation failed', fieldErrors: errors }, { status: 400 });
  }

  // All inputs are valid — verify rule IDs exist before running the transaction.
  const stallIds = stallValidated.map((r) => r.id);
  const slowIds = slowValidated.map((r) => r.id);
  const [existingStall, existingSlow] = await Promise.all([
    stallIds.length > 0 ? prisma.stallRule.findMany({ where: { id: { in: stallIds } }, select: { id: true, maxStrikes: true } }) : Promise.resolve([] as { id: string; maxStrikes: number }[]),
    slowIds.length > 0 ? prisma.slowRule.findMany({ where: { id: { in: slowIds } }, select: { id: true, maxStrikes: true } }) : Promise.resolve([] as { id: string; maxStrikes: number }[]),
  ]);
  const knownStall = new Map(existingStall.map((r) => [r.id, r.maxStrikes]));
  const knownSlow = new Map(existingSlow.map((r) => [r.id, r.maxStrikes]));
  const unknownStall = stallIds.filter((id) => !knownStall.has(id));
  const unknownSlow = slowIds.filter((id) => !knownSlow.has(id));
  if (unknownStall.length > 0 || unknownSlow.length > 0) {
    return NextResponse.json({
      error: 'one or more rule IDs no longer exist (refresh and try again)',
      unknownStallIds: unknownStall,
      unknownSlowIds: unknownSlow,
    }, { status: 409 });
  }

  // Run all updates in a transaction so a mid-flight failure doesn't leave
  // partial state. autoRunMode/interval restart happens after a successful tx.
  await prisma.$transaction(async (tx) => {
    for (const { id, value } of stallValidated) {
      await tx.stallRule.update({
        where: { id },
        data: {
          ...value,
          minimumProgressBytes: value.minimumProgressBytes != null ? BigInt(value.minimumProgressBytes) : null,
        },
      });
    }
    for (const { id, value } of slowValidated) {
      await tx.slowRule.update({
        where: { id },
        data: {
          ...value,
          ignoreAboveSizeBytes: value.ignoreAboveSizeBytes != null ? BigInt(value.ignoreAboveSizeBytes) : null,
        },
      });
    }
  });

  // After persistence, cap strikes for any rules whose maxStrikes dropped.
  // We do this outside the transaction because cleanupStrike updates are
  // independent and best-effort: even if they fail, the rule update stands.
  for (const { id, value } of stallValidated) {
    const prev = knownStall.get(id);
    if (prev != null && value.maxStrikes < prev) {
      try { await capStrikesToThreshold('stall', id, value.maxStrikes); } catch { /* logged elsewhere */ }
    }
  }
  for (const { id, value } of slowValidated) {
    const prev = knownSlow.get(id);
    if (prev != null && value.maxStrikes < prev) {
      try { await capStrikesToThreshold('slow', id, value.maxStrikes); } catch { /* logged elsewhere */ }
    }
  }

  if (cfgResult.ok) {
    await saveQueueCleanerConfig(cfgResult.value);
    await restartQueueCleaner();
  }

  // Return the fresh state so the client can replace its local view.
  const [freshConfig, freshStall, freshSlow] = await Promise.all([
    loadQueueCleanerConfig(),
    loadStallRules(),
    loadSlowRules(),
  ]);
  return NextResponse.json({
    config: freshConfig,
    stallRules: freshStall,
    slowRules: freshSlow,
  });
}

export const POST = withApiLogging(postHandler, 'api/cleanup/queue/save-all');
