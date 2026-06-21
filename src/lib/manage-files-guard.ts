// Shared input-validation + ownership guards for the Manage Episodes / Manage
// Files routes. These are the L1 (server-side) defenses from the plan: every
// mutating request is shape-validated, and every targeted file id is proven to
// belong to the stated series/movie before we forward anything to the *arr —
// the upstream bulk endpoints do NOT scope deletes/edits by series/movie, so
// this is what keeps a crafted request (and the audit row) honest.

/** A positive integer, or null. */
export function coercePositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A non-empty array of positive integers (de-duplicated), or null. */
export function coercePositiveIntArray(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const seen = new Set<number>();
  for (const v of value) {
    const n = coercePositiveInt(v);
    if (n === null) return null;
    seen.add(n);
  }
  return [...seen];
}

/** A trimmed, length-capped display string (for the audit label), or null. */
export function sanitizeTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

/**
 * Partition requested ids against the set of files that actually exist for the
 * media item. `existing` is keyed by file id. Returns the matched files (in the
 * requested order) or the ids that don't belong.
 */
export function checkOwnership<T extends { id: number }>(
  requestedIds: number[],
  existing: T[]
): { ok: true; matched: T[] } | { ok: false; missing: number[] } {
  const map = new Map(existing.map((f) => [f.id, f]));
  const matched: T[] = [];
  const missing: number[] = [];
  for (const id of requestedIds) {
    const f = map.get(id);
    if (f) matched.push(f);
    else missing.push(id);
  }
  return missing.length ? { ok: false, missing } : { ok: true, matched };
}
