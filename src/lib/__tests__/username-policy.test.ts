import { describe, expect, it } from 'vitest';
import {
  LOCAL_USERNAME_MAX_CODE_POINTS,
  localUsernameValidationError,
  normalizeLocalUsername,
} from '@/lib/username-policy';

describe('local username policy', () => {
  it('normalizes surrounding whitespace and requires a value', () => {
    expect(normalizeLocalUsername('  member  ')).toBe('member');
    expect(localUsernameValidationError('   ')).toBe('Username is required');
  });

  it('counts Unicode code points consistently with the login boundary', () => {
    expect(localUsernameValidationError(
      '🧪'.repeat(LOCAL_USERNAME_MAX_CODE_POINTS),
    )).toBeNull();
    expect(localUsernameValidationError(
      '🧪'.repeat(LOCAL_USERNAME_MAX_CODE_POINTS + 1),
    )).toBe(`Username must be at most ${LOCAL_USERNAME_MAX_CODE_POINTS} characters`);
  });
});
