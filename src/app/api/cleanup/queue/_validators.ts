import type { SlowRuleShape, StallRuleShape } from '@/lib/cleanup/types';

function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asBigIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function commonRuleValidation(b: Record<string, unknown>): { ok: true; common: Pick<StallRuleShape, 'name' | 'enabled' | 'priority' | 'maxStrikes' | 'privacyType' | 'minCompletionPercentage' | 'maxCompletionPercentage' | 'changeCategory' | 'deletePrivate' | 'reSearchOverride'> } | { ok: false; error: string } {
  const name = String(b.name ?? '').trim();
  if (!name) return { ok: false, error: 'name is required' };

  const enabled = b.enabled === undefined ? true : Boolean(b.enabled);
  const priority = Number.isFinite(Number(b.priority)) ? Math.floor(Number(b.priority)) : 0;

  const maxStrikes = Number(b.maxStrikes ?? 3);
  if (!Number.isFinite(maxStrikes) || maxStrikes < 3) return { ok: false, error: 'maxStrikes must be >= 3' };

  const privacyTypeRaw = String(b.privacyType ?? 'public');
  if (!['public', 'private', 'both'].includes(privacyTypeRaw)) return { ok: false, error: 'invalid privacyType' };
  const privacyType = privacyTypeRaw as 'public' | 'private' | 'both';

  const minPctRaw = Number(b.minCompletionPercentage ?? 0);
  const maxPctRaw = Number(b.maxCompletionPercentage ?? 100);
  if (!Number.isFinite(minPctRaw) || minPctRaw < 0 || minPctRaw > 100) return { ok: false, error: 'minCompletionPercentage out of range' };
  if (!Number.isFinite(maxPctRaw) || maxPctRaw <= 0 || maxPctRaw > 100) return { ok: false, error: 'maxCompletionPercentage out of range (1-100)' };
  // The engine's lower bound is strictly-greater for a non-zero min, so
  // min === max (e.g. 50–50) could never match any torrent.
  if (minPctRaw > 0 && maxPctRaw <= minPctRaw) return { ok: false, error: 'maxCompletionPercentage must be greater than minCompletionPercentage' };

  const changeCategory = Boolean(b.changeCategory);
  const deletePrivate = Boolean(b.deletePrivate);
  if (changeCategory && deletePrivate) return { ok: false, error: 'cannot enable both changeCategory and deletePrivate' };

  const reSearchOverride = b.reSearchOverride === null || b.reSearchOverride === undefined
    ? null
    : Boolean(b.reSearchOverride);

  return {
    ok: true,
    common: {
      name,
      enabled,
      priority,
      maxStrikes: Math.floor(maxStrikes),
      privacyType,
      minCompletionPercentage: Math.floor(minPctRaw),
      maxCompletionPercentage: Math.floor(maxPctRaw),
      changeCategory,
      deletePrivate,
      reSearchOverride,
    },
  };
}

export function validateStallRulePayload(body: unknown): { ok: true; value: Omit<StallRuleShape, 'id'> } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid body' };
  const b = body as Record<string, unknown>;
  const c = commonRuleValidation(b);
  if (!c.ok) return c;

  const resetStrikesOnProgress = b.resetStrikesOnProgress === undefined ? true : Boolean(b.resetStrikesOnProgress);
  const minimumProgressBytes = asBigIntOrNull(b.minimumProgressBytes);

  return {
    ok: true,
    value: {
      ...c.common,
      resetStrikesOnProgress,
      minimumProgressBytes,
    },
  };
}

export function validateSlowRulePayload(body: unknown): { ok: true; value: Omit<SlowRuleShape, 'id'> } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid body' };
  const b = body as Record<string, unknown>;
  const c = commonRuleValidation(b);
  if (!c.ok) return c;

  const minSpeedKbps = asNumberOrNull(b.minSpeedKbps);
  const maxTimeHours = asNumberOrNull(b.maxTimeHours);
  const ignoreAboveSizeBytes = asBigIntOrNull(b.ignoreAboveSizeBytes);
  const resetStrikesOnProgress = b.resetStrikesOnProgress === undefined ? true : Boolean(b.resetStrikesOnProgress);

  if (minSpeedKbps != null && minSpeedKbps < 0) return { ok: false, error: 'minSpeedKbps must be >= 0' };
  if (maxTimeHours != null && maxTimeHours < 0) return { ok: false, error: 'maxTimeHours must be >= 0' };
  if ((minSpeedKbps == null || minSpeedKbps <= 0) && (maxTimeHours == null || maxTimeHours <= 0)) {
    return { ok: false, error: 'either minSpeedKbps or maxTimeHours must be > 0' };
  }

  return {
    ok: true,
    value: {
      ...c.common,
      minSpeedKbps: minSpeedKbps != null ? Math.floor(minSpeedKbps) : null,
      maxTimeHours,
      ignoreAboveSizeBytes,
      resetStrikesOnProgress,
    },
  };
}
