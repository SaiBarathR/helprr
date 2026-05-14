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
  const priority = Number.isFinite(Number(b.priority)) ? Math.floor(Number(b.priority)) : 0;

  // Empty categories means "apply to all categories" (cleanuparr-style).
  // To still match _something_ the rule must constrain by at least one of:
  // categories, trackerPatterns, tagsAny, tagsAll. Otherwise it would match
  // every seeding torrent and is almost certainly user error.
  const categories = strArr(b.categories);
  const trackerPatterns = strArr(b.trackerPatterns);
  const tagsAny = strArr(b.tagsAny);
  const tagsAll = strArr(b.tagsAll);

  const privacyTypeRaw = String(b.privacyType ?? 'both');
  if (!['public', 'private', 'both'].includes(privacyTypeRaw)) return { ok: false, error: 'invalid privacyType' };
  const privacyType = privacyTypeRaw as 'public' | 'private' | 'both';

  const maxRatio = Number(b.maxRatio ?? -1);
  const minSeedTimeHours = Number(b.minSeedTimeHours ?? 0);
  const maxSeedTimeHours = Number(b.maxSeedTimeHours ?? -1);
  if (!Number.isFinite(maxRatio)) return { ok: false, error: 'maxRatio invalid' };
  if (!Number.isFinite(minSeedTimeHours) || minSeedTimeHours < 0) return { ok: false, error: 'minSeedTimeHours must be >= 0' };
  if (!Number.isFinite(maxSeedTimeHours)) return { ok: false, error: 'maxSeedTimeHours invalid' };
  if (maxRatio < 0 && maxSeedTimeHours < 0) {
    return { ok: false, error: 'either maxRatio or maxSeedTimeHours must be >= 0' };
  }

  const deleteSourceFiles = b.deleteSourceFiles === undefined ? true : Boolean(b.deleteSourceFiles);

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
    },
  };
}
