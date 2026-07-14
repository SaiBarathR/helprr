import { isSupportedPasswordHash } from '@/lib/password';

export const MAX_IMPORT_NESTING_DEPTH = 32;
export const MAX_IMPORT_ARRAY_ENTRIES = 20_000;
export const MAX_IMPORT_OBJECT_PROPERTIES = 50_000;

/**
 * Bound parsed document complexity before any database work. The byte limit
 * alone does not stop a small JSON file containing hundreds of thousands of
 * empty array entries or deeply nested objects from monopolizing an import.
 */
export function validateSettingsImportComplexity(value: unknown): string | null {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let arrayEntries = 0;
  let objectProperties = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (!current.value || typeof current.value !== 'object') continue;
    if (current.depth > MAX_IMPORT_NESTING_DEPTH) {
      return `Import nesting exceeds ${MAX_IMPORT_NESTING_DEPTH} levels`;
    }

    if (Array.isArray(current.value)) {
      arrayEntries += current.value.length;
      if (arrayEntries > MAX_IMPORT_ARRAY_ENTRIES) {
        return `Import arrays exceed ${MAX_IMPORT_ARRAY_ENTRIES} total entries`;
      }
      for (const child of current.value) {
        pending.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }

    const entries = Object.entries(current.value as Record<string, unknown>);
    objectProperties += entries.length;
    if (objectProperties > MAX_IMPORT_OBJECT_PROPERTIES) {
      return `Import objects exceed ${MAX_IMPORT_OBJECT_PROPERTIES} total properties`;
    }
    for (const [, child] of entries) {
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }

  return null;
}

export function resolveImportedPasswordHash(
  imported: unknown,
  existing: string | null | undefined,
): { passwordHash: string | null; rejected: boolean } {
  if (typeof imported !== 'string' || imported.length === 0) {
    return { passwordHash: existing ?? null, rejected: false };
  }
  if (!isSupportedPasswordHash(imported)) {
    return { passwordHash: existing ?? null, rejected: true };
  }
  return { passwordHash: imported, rejected: false };
}
