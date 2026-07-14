import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPasswordHash } from '@/lib/password';

describe('legacy local-password compatibility', () => {
  it('continues verifying an existing short password hash after the creation minimum rises', async () => {
    const stored = await hashPassword('legacy');
    await expect(verifyPasswordHash('legacy', stored)).resolves.toBe(true);
    await expect(verifyPasswordHash('wrong', stored)).resolves.toBe(false);
  });
});
