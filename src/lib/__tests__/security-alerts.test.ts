import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  findMany: vi.fn(),
  aggregate: vi.fn(),
  notify: vi.fn(async () => 0),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
    securityAuditEvent: { findMany: mocks.findMany, aggregate: mocks.aggregate },
  },
}));
vi.mock('@/lib/notification-service', () => ({ notifyEvent: mocks.notify }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  alertOnFailedSignInBurst,
  alertOnNewDeviceSignIn,
  alertOnTwoStepDisabled,
  deviceFamily,
  FAILED_SIGN_IN_BURST,
} from '@/lib/security-alerts';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('new-device sign-in', () => {
  const IPHONE_18_1 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
  const IPHONE_18_2 = IPHONE_18_1.replace(/18_1/, '18_2').replace('Version/18.1', 'Version/18.2');

  it('alerts admins for a browser their sign-ins never used, with its own tag', async () => {
    mocks.findUser.mockResolvedValue({ role: 'admin', username: 'boss' });
    mocks.findMany.mockResolvedValue([{ userAgent: 'Firefox/140' }, { userAgent: IPHONE_18_1 }]); // this sign-in, and an older one
    await alertOnNewDeviceSignIn('u1', 'Firefox/140', '203.0.113.0/24');
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { action: 'LOGIN_SUCCEEDED', actorUserId: 'u1' } }));
    const event = (mocks.notify.mock.calls[0] as unknown as [{ eventType: string; body: string; metadata: { id: string } }])[0];
    expect(event.eventType).toBe('securityAlert');
    expect(event.body).toContain('boss signed in from a browser or device not seen before (network 203.0.113.0/24)');
    expect(event.metadata.id).toMatch(/^new-device-/);
  });

  it('stays quiet for a known browser after an OS or browser update, and for members', async () => {
    mocks.findUser.mockResolvedValue({ role: 'admin', username: 'boss' });
    mocks.findMany.mockResolvedValue([{ userAgent: IPHONE_18_2 }, { userAgent: IPHONE_18_1 }]);
    await alertOnNewDeviceSignIn('u1', IPHONE_18_2, null);
    mocks.findUser.mockResolvedValue({ role: 'member', username: 'kid' });
    await alertOnNewDeviceSignIn('u2', 'Safari', null);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(deviceFamily(IPHONE_18_1)).toBe(deviceFamily(IPHONE_18_2));
  });
});

describe('failed sign-in burst', () => {
  it('alerts once per window when the window reaches the threshold', async () => {
    const now = Date.parse('2026-11-07T10:05:00Z');
    mocks.aggregate.mockResolvedValue({ _sum: { count: FAILED_SIGN_IN_BURST } });
    await alertOnFailedSignInBurst(now);
    expect(mocks.aggregate).toHaveBeenCalledWith({
      where: { action: 'LOGIN_FAILED', createdAt: { gte: new Date(now - 10 * 60_000) } },
      _sum: { count: true },
    });
    const event = (mocks.notify.mock.calls[0] as unknown as [{ dedupeKey: string; eventType: string }])[0];
    expect(event.eventType).toBe('securityAlert');
    // The same key for every attempt in the window: notifyEvent's dedupe sends it once.
    await alertOnFailedSignInBurst(now + 60_000);
    const again = (mocks.notify.mock.calls[1] as unknown as [{ dedupeKey: string }])[0];
    expect(again.dedupeKey).toBe(event.dedupeKey);
  });

  it('stays quiet below the threshold', async () => {
    mocks.aggregate.mockResolvedValue({ _sum: { count: FAILED_SIGN_IN_BURST - 1 } });
    await alertOnFailedSignInBurst();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});

describe('two-step turned off', () => {
  it('names the account and who turned it off', async () => {
    await alertOnTwoStepDisabled('kid', 'boss');
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'securityAlert',
      body: 'Two-step sign-in was turned off for kid by boss.',
    }));
    await alertOnTwoStepDisabled('kid', 'kid');
    expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({ body: 'Two-step sign-in was turned off for kid.' }));
  });
});
