import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ userUpdate: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: { user: { update: mocks.userUpdate } } }));

import { invalidateJellyfinToken, readJellyfinToken, storeJellyfinToken } from '@/lib/jellyfin-token';

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

  it('invalidate clears the stored token', async () => {
    mocks.userUpdate.mockResolvedValue({});
    await invalidateJellyfinToken('user-1');
    expect(mocks.userUpdate).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { jellyfinToken: null } });
  });
});
