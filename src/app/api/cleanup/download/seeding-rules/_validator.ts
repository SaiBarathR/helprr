import type { SeedingRuleShape } from '@/lib/cleanup/types';

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? (v as unknown[]).map(String).map((s) => s.trim()).filter(Boolean) : [];
}

export function validateSeedingRulePayload(body: unknown): { ok: true; value: Omit<SeedingRuleShape, 'id' | 'isSystem'> } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid body' };
  const b = body as Record<string, unknown>;

  const name = String(b.name ?? '').trim();
  if (!name) return { ok: false, error: 'name is required' };
  const enabled = b.enabled === undefined ? true : Boolean(b.enabled);
  // User priority is clamped to >= 0. The system row reserves -1000 so it
  // wins category overlaps without users being able to undercut it.
  const priorityRaw = Number.isFinite(Number(b.priority)) ? Math.floor(Number(b.priority)) : 0;
  if (priorityRaw < 0) return { ok: false, error: 'priority must be >= 0 (negative values are reserved)' };
  const priority = priorityRaw;

  const categories = strArr(b.categories);
  const trackerPatterns = strArr(b.trackerPatterns);
  const tagsAny = strArr(b.tagsAny);
  const tagsAll = strArr(b.tagsAll);
  // A rule with no category / tracker / tag filter matches every seeding
  // torrent. Combined with a permissive predicate that can fire instantly,
  // this is almost always user error (and a fast path to deleting in-flight
  // arr imports). Force at least one filter to be set.
  if (categories.length === 0 && trackerPatterns.length === 0 && tagsAny.length === 0 && tagsAll.length === 0) {
    return { ok: false, error: 'rule must constrain by at least one of categories, trackerPatterns, tagsAny, or tagsAll' };
  }

  const privacyTypeRaw = String(b.privacyType ?? 'both');
  if (!['public', 'private', 'both'].includes(privacyTypeRaw)) return { ok: false, error: 'invalid privacyType' };
  const privacyType = privacyTypeRaw as 'public' | 'private' | 'both';

  const maxRatio = Number(b.maxRatio ?? -1);
  const minSeedTimeHours = Number(b.minSeedTimeHours ?? 0);
  const maxSeedTimeHours = Number(b.maxSeedTimeHours ?? -1);
  // Only the documented `-1` sentinel disables a threshold; other negatives
  // were previously accepted and silently produced rules that never fire.
  if (!Number.isFinite(maxRatio) || (maxRatio < 0 && maxRatio !== -1)) return { ok: false, error: 'maxRatio must be >= 0, or -1 to disable' };
  if (!Number.isFinite(minSeedTimeHours) || minSeedTimeHours < 0) return { ok: false, error: 'minSeedTimeHours must be >= 0' };
  if (!Number.isFinite(maxSeedTimeHours) || (maxSeedTimeHours < 0 && maxSeedTimeHours !== -1)) return { ok: false, error: 'maxSeedTimeHours must be >= 0, or -1 to disable' };
  // `-1` is the documented "unbounded" sentinel for maxSeedTimeHours, so we
  // only enforce the min/max ordering when the user has set an upper bound.
  if (maxSeedTimeHours >= 0 && minSeedTimeHours > maxSeedTimeHours) {
    return { ok: false, error: 'minSeedTimeHours cannot exceed maxSeedTimeHours' };
  }
  // With both thresholds disabled the predicate `(ratio && minTime) || maxTime`
  // can never be satisfied — the rule would be permanently inert while still
  // claiming (and shadowing) every torrent its filters match.
  if (maxRatio === -1 && maxSeedTimeHours === -1) {
    return { ok: false, error: 'rule can never trigger: set Max ratio >= 0 or Max seed time >= 0 (Min seed time only gates the ratio condition)' };
  }

  const deleteSourceFiles = b.deleteSourceFiles === undefined ? true : Boolean(b.deleteSourceFiles);
  const requireImportedConfirmation = Boolean(b.requireImportedConfirmation);

  return {
    ok: true,
    value: {
      name,
      enabled,
      priority,
      categories,
      trackerPatterns,
      tagsAny,
      tagsAll,
      privacyType,
      maxRatio,
      minSeedTimeHours,
      maxSeedTimeHours,
      deleteSourceFiles,
      requireImportedConfirmation,
    },
  };
}
