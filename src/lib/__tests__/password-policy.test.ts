import { describe, expect, it } from 'vitest';
import {
  LOCAL_PASSWORD_MIN_LENGTH,
  countPasswordCodePoints,
  localPasswordValidationError,
} from '@/lib/password-policy';

describe('local password policy', () => {
  it('requires 15 characters for newly set local passwords', () => {
    expect(LOCAL_PASSWORD_MIN_LENGTH).toBe(15);
    expect(localPasswordValidationError('a'.repeat(14))).toBe(
      'Password must be at least 15 characters',
    );
    expect(localPasswordValidationError('a'.repeat(15))).toBeNull();
  });

  it('counts Unicode code points instead of UTF-16 code units', () => {
    expect(countPasswordCodePoints('😀'.repeat(15))).toBe(15);
    expect(localPasswordValidationError('😀'.repeat(14))).not.toBeNull();
    expect(localPasswordValidationError('😀'.repeat(15))).toBeNull();
  });

  it('does not impose character-class composition rules', () => {
    expect(localPasswordValidationError('correct horse battery staple')).toBeNull();
  });
});
