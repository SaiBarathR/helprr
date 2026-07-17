import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { loadQueueCleanerConfig, saveQueueCleanerConfig } from '@/lib/cleanup/queue-cleaner';
import { restartQueueCleaner } from '@/lib/cleanup/scheduler';
import {
  AUTO_RUN_MODES,
  AutoRunMode,
  DEFAULT_FAILED_IMPORT,
  FailedImportConfig,
  QueueCleanerConfigShape,
} from '@/lib/cleanup/types';

function validateConfig(body: unknown): { ok: true; value: QueueCleanerConfigShape } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid body' };
  const b = body as Record<string, unknown>;
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

async function getHandler() {
  const err = await requireAuth();
  if (err) return err;
  const capError = await requireCapability('cleanup.view');
  if (capError) return capError;
  const cfg = await loadQueueCleanerConfig();
  return NextResponse.json(cfg);
}

async function putHandler(req: NextRequest) {
  const err = await requireAuth();
  if (err) return err;
  const capError = await requireCapability('cleanup.manage');
  if (capError) return capError;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const result = validateConfig(body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  await saveQueueCleanerConfig(result.value);
  // Always restart: any change to enabled, intervalMinutes, or autoRunMode
  // must take effect immediately on the scheduler.
  await restartQueueCleaner();
  return NextResponse.json(result.value);
}

export const GET = withApiLogging(getHandler, 'api/cleanup/queue/config');
export const PUT = withApiLogging(putHandler, 'api/cleanup/queue/config');
