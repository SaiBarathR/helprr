import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { loadDownloadCleanerConfig, saveDownloadCleanerConfig } from '@/lib/cleanup/download-cleaner';
import { restartDownloadCleaner } from '@/lib/cleanup/scheduler';
import { AUTO_RUN_MODES, AutoRunMode, DownloadCleanerConfigShape, PrivacyType } from '@/lib/cleanup/types';
import { findConflictingRuleLevelRules } from '../seeding-rules/_mutual-exclusion';

const PRIVACY_TYPES: PrivacyType[] = ['public', 'private', 'both'];

function validate(body: unknown): { ok: true; value: DownloadCleanerConfigShape } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid body' };
  const b = body as Record<string, unknown>;
  const enabled = Boolean(b.enabled);
  const intervalMinutes = Number(b.intervalMinutes);
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) return { ok: false, error: 'intervalMinutes must be >= 1' };
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

async function getHandler() {
  const err = await requireAuth();
  if (err) return err;
  const cfg = await loadDownloadCleanerConfig();
  return NextResponse.json(cfg);
}

async function putHandler(req: NextRequest) {
  const err = await requireAuth();
  if (err) return err;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const v = validate(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  if (v.value.autoRemoveImportedEnabled) {
    const conflicts = await findConflictingRuleLevelRules();
    if (conflicts) {
      return NextResponse.json(
        {
          error: 'Disable rule-level import confirmation on the listed rules first.',
          conflictingRules: conflicts,
        },
        { status: 409 },
      );
    }
  }

  await saveDownloadCleanerConfig(v.value);
  await restartDownloadCleaner();
  return NextResponse.json(v.value);
}

export const GET = withApiLogging(getHandler, 'api/cleanup/download/config');
export const PUT = withApiLogging(putHandler, 'api/cleanup/download/config');
