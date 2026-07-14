import { describe, expect, it } from 'vitest';
import { hashPassword, isSupportedPasswordHash, verifyPasswordHash } from '@/lib/password';
import {
  MAX_IMPORT_ARRAY_ENTRIES,
  MAX_IMPORT_NESTING_DEPTH,
  resolveImportedPasswordHash,
  validateSettingsImportComplexity,
} from '@/lib/settings-import-validation';

describe('settings import validation', () => {
  it('accepts generated Helprr hashes and rejects malformed or excessive-cost values', async () => {
    const valid = await hashPassword('a sufficiently long test password');
    expect(isSupportedPasswordHash(valid)).toBe(true);
    expect(await verifyPasswordHash('a sufficiently long test password', valid)).toBe(true);

    const malformed = [
      'plaintext',
      'scrypt$3$8$1$c2FsdHNhbHQ=$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNo',
      'scrypt$1048576$32$16$c2FsdHNhbHQ=$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNo',
      `scrypt$16384$8$1$${'A'.repeat(2048)}$${'A'.repeat(2048)}`,
      'scrypt$16384$8$1$not*base64$also*not*base64',
    ];
    for (const value of malformed) {
      expect(isSupportedPasswordHash(value), value).toBe(false);
      expect(await verifyPasswordHash('anything', value), value).toBe(false);
    }
  });

  it('preserves an existing hash when a hostile import supplies an invalid replacement', async () => {
    const existing = await hashPassword('the existing valid test password');

    expect(resolveImportedPasswordHash('plaintext-password', existing)).toEqual({
      passwordHash: existing,
      rejected: true,
    });
    expect(resolveImportedPasswordHash(undefined, existing)).toEqual({
      passwordHash: existing,
      rejected: false,
    });
    expect(resolveImportedPasswordHash('plaintext-password', null)).toEqual({
      passwordHash: null,
      rejected: true,
    });
  });

  it('bounds aggregate array entries and nesting before import work starts', () => {
    expect(validateSettingsImportComplexity({ values: Array(MAX_IMPORT_ARRAY_ENTRIES).fill(null) })).toBeNull();
    expect(
      validateSettingsImportComplexity({ values: Array(MAX_IMPORT_ARRAY_ENTRIES + 1).fill(null) }),
    ).toContain('arrays exceed');

    let nested: Record<string, unknown> = {};
    const root = nested;
    for (let depth = 0; depth <= MAX_IMPORT_NESTING_DEPTH; depth += 1) {
      const child: Record<string, unknown> = {};
      nested.child = child;
      nested = child;
    }
    expect(validateSettingsImportComplexity(root)).toContain('nesting exceeds');
  });
});
