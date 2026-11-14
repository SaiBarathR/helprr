import crypto from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authDeviceId } from '@/lib/jellyfin-client';

// Jellyfin 12 revokes a user's previous token when they sign in again with the
// same DeviceId, so two installs on one Jellyfin must not share these ids.

const SECRET = 'install-a-secret-0123456789abcdef';

afterEach(() => vi.unstubAllEnvs());

describe('authDeviceId', () => {
  it('is stable for the same secret and username', () => {
    vi.stubEnv('JWT_SECRET', SECRET);
    expect(authDeviceId('member')).toMatch(/^helprr-user-[0-9a-f]{16}$/);
    expect(authDeviceId('member')).toBe(authDeviceId('member'));
  });

  it('ignores the username\'s case, as Jellyfin does', () => {
    vi.stubEnv('JWT_SECRET', SECRET);
    expect(authDeviceId('Member')).toBe(authDeviceId('member'));
  });

  it('differs between users on one install', () => {
    vi.stubEnv('JWT_SECRET', SECRET);
    expect(authDeviceId('member')).not.toBe(authDeviceId('other'));
  });

  it('differs under another install\'s secret', () => {
    vi.stubEnv('JWT_SECRET', SECRET);
    const first = authDeviceId('member');
    vi.stubEnv('JWT_SECRET', 'install-b-secret-fedcba9876543210');
    expect(authDeviceId('member')).not.toBe(first);
  });

  it('falls back to APP_PASSWORD and fails closed with neither secret', () => {
    vi.stubEnv('JWT_SECRET', '');
    vi.stubEnv('APP_PASSWORD', SECRET);
    expect(authDeviceId('member')).toMatch(/^helprr-user-[0-9a-f]{16}$/);
    vi.stubEnv('APP_PASSWORD', '');
    expect(() => authDeviceId('member')).toThrow(/JWT_SECRET or APP_PASSWORD/);
  });

  it('carries neither the username nor the secret, nor the old unkeyed hash', () => {
    vi.stubEnv('JWT_SECRET', SECRET);
    const id = authDeviceId('membername');
    expect(id).not.toContain('membername');
    expect(id).not.toContain(SECRET);
    const keyHex = crypto.createHash('sha256').update(SECRET).digest('hex');
    expect(keyHex).not.toContain(id.slice('helprr-user-'.length));
    const unkeyed = crypto.createHash('sha256').update('membername').digest('hex').slice(0, 16);
    expect(id).not.toBe(`helprr-user-${unkeyed}`);
  });
});

describe('JellyfinClient.authenticateByName without an install secret', () => {
  it('answers unavailable instead of throwing, and sends nothing', async () => {
    const { JellyfinClient } = await import('@/lib/jellyfin-client');
    const axios = (await import('axios')).default;
    vi.stubEnv('JWT_SECRET', '');
    vi.stubEnv('APP_PASSWORD', '');
    const post = vi.spyOn(axios, 'post');
    await expect(JellyfinClient.authenticateByName('http://jellyfin.invalid', 'member', 'pw')).resolves.toEqual({ ok: false, reason: 'unavailable' });
    expect(post).not.toHaveBeenCalled();
    post.mockRestore();
  });
});
