import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ userUpdate: vi.fn(), userUpdateMany: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: { user: { update: mocks.userUpdate, updateMany: mocks.userUpdateMany } } }));

import { clearJellyfinToken, invalidateJellyfinToken, readJellyfinToken, storeJellyfinToken } from '@/lib/jellyfin-token';

/** The value storeJellyfinToken would have written for `plaintext`. */
async function ciphertextFor(plaintext: string): Promise<string> {
  mocks.userUpdate.mockResolvedValue({});
  await storeJellyfinToken('user-1', plaintext);
  return mocks.userUpdate.mock.calls.at(-1)![0].data.jellyfinToken as string;
}

describe('jellyfin token store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'secret-under-test-0123456789abcdef';
  });

  it('round-trips a token through storage', async () => {
    const stored = await ciphertextFor('jf-access-token');
    expect(readJellyfinToken({ jellyfinToken: stored })).toBe('jf-access-token');
  });

  it('does not store the token in plaintext', async () => {
    const stored = await ciphertextFor('jf-access-token');
    expect(stored).toMatch(/^enc:v1:/);
    expect(stored).not.toContain('jf-access-token');
  });

  it('uses a fresh IV per write, so equal tokens do not produce equal ciphertext', async () => {
    expect(await ciphertextFor('same-token')).not.toBe(await ciphertextFor('same-token'));
  });

  it('reads a pre-encryption plaintext token as-is', () => {
    expect(readJellyfinToken({ jellyfinToken: 'legacy-plaintext-token' })).toBe('legacy-plaintext-token');
  });

  it('treats a token from a rotated secret as absent instead of throwing', async () => {
    const stored = await ciphertextFor('jf-access-token');
    process.env.JWT_SECRET = 'a-completely-different-secret-value';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readJellyfinToken({ jellyfinToken: stored })).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects a tampered ciphertext rather than returning garbage', async () => {
    const stored = await ciphertextFor('jf-access-token');
    const body = Buffer.from(stored.slice('enc:v1:'.length), 'base64');
    body[body.length - 1] ^= 0xff;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readJellyfinToken({ jellyfinToken: `enc:v1:${body.toString('base64')}` })).toBeNull();
    warn.mockRestore();
  });

  it('reports no token when the column is empty', () => {
    expect(readJellyfinToken({ jellyfinToken: null })).toBeNull();
  });

  it('invalidate clears the token only while the stored value is still the one that failed', async () => {
    mocks.userUpdateMany.mockResolvedValue({ count: 1 });
    const failed = await ciphertextFor('old-token');
    await invalidateJellyfinToken('user-1', failed);
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', jellyfinToken: failed },
      data: { jellyfinToken: null },
    });
  });

  it('invalidate leaves a newer token another sign-in stored', async () => {
    // A stand-in for the column: the conditional update only matches its current value.
    let column: string | null = await ciphertextFor('old-token');
    const failed = column;
    column = await ciphertextFor('new-token');
    mocks.userUpdateMany.mockImplementation(async ({ where, data }) => {
      if (where.jellyfinToken !== column) return { count: 0 };
      column = data.jellyfinToken;
      return { count: 1 };
    });
    await invalidateJellyfinToken('user-1', failed);
    expect(column).not.toBeNull();
    expect(readJellyfinToken({ jellyfinToken: column })).toBe('new-token');
    await invalidateJellyfinToken('user-1', column);
    expect(column).toBeNull();
  });

  it('invalidate does nothing when the request read no token', async () => {
    await invalidateJellyfinToken('user-1', null);
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it('clear drops whatever token is stored, for an explicit disconnect', async () => {
    mocks.userUpdate.mockResolvedValue({});
    await clearJellyfinToken('user-1');
    expect(mocks.userUpdate).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { jellyfinToken: null } });
  });
});
