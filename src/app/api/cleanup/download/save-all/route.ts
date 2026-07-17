import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import {
  loadDownloadCleanerConfig,
  loadSeedingRules,
  saveDownloadCleanerConfig,
} from '@/lib/cleanup/download-cleaner';
import { restartDownloadCleaner } from '@/lib/cleanup/scheduler';
import { AUTO_RUN_MODES, AutoRunMode, DownloadCleanerConfigShape, PrivacyType, SeedingRuleShape } from '@/lib/cleanup/types';

const PRIVACY_TYPES: PrivacyType[] = ['public', 'private', 'both'];
import { validateSeedingRulePayload } from '../seeding-rules/_validator';

type SeedingRuleInput = Omit<SeedingRuleShape, 'id' | 'isSystem'>;

interface FieldError {
  scope: 'config' | 'rule';
  id?: string;
  message: string;
}

function validateConfig(b: Record<string, unknown>): { ok: true; value: DownloadCleanerConfigShape } | { ok: false; error: string } {
  const enabled = Boolean(b.enabled);
  const intervalMinutes = Number(b.intervalMinutes);
  // Upper bound keeps the scheduler delay far below the 32-bit setInterval
  // limit (~24.8 days), where Node would clamp to ~1ms and run continuously.
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 10080) return { ok: false, error: 'intervalMinutes must be between 1 and 10080 (7 days)' };
  const ignoredDownloads = Array.isArray(b.ignoredDownloads)
    ? (b.ignoredDownloads as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
    : [];
  const autoRemoveImportedEnabled = Boolean(b.autoRemoveImportedEnabled);
  const cats = Array.isArray(b.autoRemoveImportedCategories)
    ? (b.autoRemoveImportedCategories as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
    : [];
  if (autoRemoveImportedEnabled && cats.length === 0) {
    return { ok: false, error: 'autoRemoveImported: at least one category required when this feature is on' };
  }
  const autoRemoveImportedDeleteFiles = b.autoRemoveImportedDeleteFiles === undefined ? true : Boolean(b.autoRemoveImportedDeleteFiles);
  const privacyRaw = String(b.autoRemoveImportedPrivacyType ?? 'public');
  if (!(PRIVACY_TYPES as string[]).includes(privacyRaw)) {
    return { ok: false, error: `autoRemoveImportedPrivacyType must be one of: ${PRIVACY_TYPES.join(', ')}` };
  }
  const autoRemoveImportedPrivacyType = privacyRaw as PrivacyType;
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
      autoRemoveImportedEnabled,
      autoRemoveImportedCategories: cats,
      autoRemoveImportedDeleteFiles,
      autoRemoveImportedPrivacyType,
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

  const rulesRaw = Array.isArray(body.seedingRules) ? (body.seedingRules as Record<string, unknown>[]) : [];
  const ruleValidated: { id: string; value: SeedingRuleInput }[] = [];

  for (const r of rulesRaw) {
    const id = typeof r.id === 'string' ? r.id : '';
    if (!id) { errors.push({ scope: 'rule', message: 'rule missing id' }); continue; }
    const v = validateSeedingRulePayload(r);
    if (!v.ok) errors.push({ scope: 'rule', id, message: v.error });
    else ruleValidated.push({ id, value: v.value });
  }

  if (errors.length > 0 || !cfgResult.ok) {
    return NextResponse.json({ error: 'validation failed', fieldErrors: errors }, { status: 400 });
  }

  // Mutual exclusion: rule-level `requireImportedConfirmation` and the global
  // `autoRemoveImportedEnabled` cannot both be on. If any incoming rule claims
  // import confirmation while the incoming config still has the global on,
  // force the global off and surface the flip in the response so the UI can
  // toast the user. Disabled rules don't count toward the conflict.
  let globalAutoRemoveDisabled = false;
  const anyRuleClaimsConfirmation = ruleValidated.some(
    (r) => r.value.enabled && r.value.requireImportedConfirmation,
  );
  if (anyRuleClaimsConfirmation && cfgResult.value.autoRemoveImportedEnabled) {
    cfgResult.value.autoRemoveImportedEnabled = false;
    globalAutoRemoveDisabled = true;
  }

  // Verify rule IDs exist, and refuse to touch any system rule (those are
  // managed by the config toggle, not the user-editable rule list).
  const ids = ruleValidated.map((r) => r.id);
  const existing = ids.length > 0
    ? await prisma.seedingRule.findMany({ where: { id: { in: ids } }, select: { id: true, isSystem: true } })
    : [];
  const knownIds = new Map(existing.map((r) => [r.id, r.isSystem]));
  const unknown = ids.filter((id) => !knownIds.has(id));
  const systemIds = ids.filter((id) => knownIds.get(id) === true);
  if (unknown.length > 0 || systemIds.length > 0) {
    return NextResponse.json({
      error: unknown.length > 0
        ? 'one or more rule IDs no longer exist (refresh and try again)'
        : 'system rules cannot be edited directly',
      unknownIds: unknown,
      systemIds,
    }, { status: 409 });
  }

  // Commit rule updates AND the cleaner-config write in one transaction so
  // we never leave the DB with rules saved but config stale (or vice versa).
  // `syncSystemSeedingRule` and the scheduler restart run after the tx
  // commits — both are idempotent and run on a successful row state.
  await prisma.$transaction(async (tx) => {
    for (const { id, value } of ruleValidated) {
      await tx.seedingRule.update({
        where: { id },
        data: {
          name: value.name,
          enabled: value.enabled,
          priority: value.priority,
          categories: value.categories,
          trackerPatterns: value.trackerPatterns,
          tagsAny: value.tagsAny,
          tagsAll: value.tagsAll,
          privacyType: value.privacyType,
          maxRatio: value.maxRatio,
          minSeedTimeHours: value.minSeedTimeHours,
          maxSeedTimeHours: value.maxSeedTimeHours,
          deleteSourceFiles: value.deleteSourceFiles,
          requireImportedConfirmation: value.requireImportedConfirmation,
        },
      });
    }
    if (cfgResult.ok) {
      await tx.downloadCleanerConfig.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', ...cfgResult.value },
        update: cfgResult.value,
      });
    }
  });

  if (cfgResult.ok) {
    // Re-run saveDownloadCleanerConfig to drive syncSystemSeedingRule with
    // the just-committed config. The inner upsert is a no-op (rules+config
    // already match), so the extra cost is one redundant write — worth it
    // to keep the system-rule sync flow centralised in one place.
    await saveDownloadCleanerConfig(cfgResult.value);
    await restartDownloadCleaner();
  }

  const [freshConfig, freshRules] = await Promise.all([
    loadDownloadCleanerConfig(),
    loadSeedingRules(),
  ]);
  return NextResponse.json({
    config: freshConfig,
    // System rules are hidden from the list returned to the UI (matches GET behavior).
    seedingRules: freshRules.filter((r) => !r.isSystem),
    globalAutoRemoveDisabled,
  });
}

export const POST = withApiLogging(postHandler, 'api/cleanup/download/save-all');
