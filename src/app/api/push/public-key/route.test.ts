import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));

import { GET } from './route';

const as = (role: 'admin' | 'member') => mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'u', role } });
const read = async () => (await (GET as unknown as () => Promise<Response>)()).json();

beforeEach(() => {
  vi.stubEnv('VAPID_PUBLIC_KEY', 'public');
  vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '');
  vi.stubEnv('VAPID_PRIVATE_KEY', 'private');
  vi.stubEnv('VAPID_SUBJECT', 'mailto:me@example.com');
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/push/public-key', () => {
  it('reports push as configured when all three values are set', async () => {
    as('admin');
    expect(await read()).toEqual({ publicKey: 'public', configured: true });
  });

  it('is not configured with only the public key, and tells an admin what is missing', async () => {
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    vi.stubEnv('VAPID_SUBJECT', '');
    as('admin');
    expect(await read()).toEqual({ publicKey: 'public', configured: false, missing: ['VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] });
  });

  it('gives a member only the answer, not the variable names', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '');
    as('member');
    expect(await read()).toEqual({ publicKey: null, configured: false });
  });

  it('accepts the old public key name', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'old-name');
    as('admin');
    expect(await read()).toEqual({ publicKey: 'old-name', configured: true });
  });
});
