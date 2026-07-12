import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getVapidPublicKey } from '@/lib/vapid';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
});

afterAll(() => {
  process.env = ORIGINAL;
});

describe('getVapidPublicKey', () => {
  it('returns null when no key is configured', () => {
    expect(getVapidPublicKey()).toBeNull();
  });

  it('prefers the canonical VAPID_PUBLIC_KEY', () => {
    process.env.VAPID_PUBLIC_KEY = 'canonical';
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'legacy';
    expect(getVapidPublicKey()).toBe('canonical');
  });

  it('falls back to the legacy NEXT_PUBLIC_ name so old .env files keep working', () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'legacy';
    expect(getVapidPublicKey()).toBe('legacy');
  });
});
