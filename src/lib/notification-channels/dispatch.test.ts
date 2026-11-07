import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationChannel } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  update: vi.fn(async () => ({})),
  updateMany: vi.fn(async () => ({ count: 1 })),
  send: vi.fn(async () => {}),
  warn: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: { notificationChannel: { update: mocks.update, updateMany: mocks.updateMany } } }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() } }));
vi.mock('./transports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./transports')>()),
  sendToChannel: mocks.send,
}));

import { encryptSecrets } from './config';
import { channelBackoffMs, deliverToChannel, dispatchToChannels, shouldDeferChannel } from './dispatch';
import { ChannelSendError, type ChannelMessage } from './transports';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-tests';
});

beforeEach(() => {
  vi.clearAllMocks();
});

const message: ChannelMessage = {
  eventType: 'imported', title: 'T', body: 'B', link: null, path: null, metadata: {}, sentAt: '2026-11-07T00:00:00Z',
};

const ADMIN = { allowPrivate: true };

function row(extra: Partial<NotificationChannel> = {}): NotificationChannel {
  return {
    id: 'c1', userId: 'u1', type: 'ntfy', name: 'Phone', enabled: true, events: ['imported'],
    config: { serverUrl: 'https://ntfy.sh' }, secrets: encryptSecrets({ topic: 'secret-topic-123' }),
    consecutiveFailures: 0, lastFailedAt: null, lastSucceededAt: null, lastError: null,
    createdAt: new Date(), updatedAt: new Date(), ...extra,
  } as NotificationChannel;
}

describe('backoff', () => {
  it('doubles from five minutes to a six-hour cap', () => {
    expect(channelBackoffMs(0)).toBe(0);
    expect(channelBackoffMs(1)).toBe(5 * 60_000);
    expect(channelBackoffMs(2)).toBe(10 * 60_000);
    expect(channelBackoffMs(30)).toBe(6 * 60 * 60_000);
  });

  it('defers only inside the window and not after a later success', () => {
    const now = Date.parse('2026-11-07T12:00:00Z');
    const failedAt = new Date(now - 4 * 60_000);
    expect(shouldDeferChannel({ consecutiveFailures: 1, lastFailedAt: failedAt, lastSucceededAt: null }, now)).toBe(true);
    expect(shouldDeferChannel({ consecutiveFailures: 1, lastFailedAt: new Date(now - 6 * 60_000), lastSucceededAt: null }, now)).toBe(false);
    expect(shouldDeferChannel({ consecutiveFailures: 1, lastFailedAt: failedAt, lastSucceededAt: new Date(now - 60_000) }, now)).toBe(false);
  });
});

describe('deliverToChannel', () => {
  it('decrypts the secrets for the send and resets the failure count on success', async () => {
    expect(await deliverToChannel(row({ consecutiveFailures: 3 }), message, ADMIN)).toEqual({ ok: true });
    expect(mocks.send).toHaveBeenCalledWith('ntfy', { serverUrl: 'https://ntfy.sh' }, { topic: 'secret-topic-123' }, message, ADMIN);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({ consecutiveFailures: 0, lastError: null }),
    });
  });

  it('counts a failure with its short reason and logs no secret', async () => {
    mocks.send.mockRejectedValueOnce(new ChannelSendError('HTTP 403'));
    expect(await deliverToChannel(row(), message, ADMIN)).toEqual({ ok: false, reason: 'HTTP 403' });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', OR: [{ lastFailedAt: null }, { lastFailedAt: { lt: expect.any(Date) } }] },
      data: expect.objectContaining({ consecutiveFailures: { increment: 1 }, lastError: 'HTTP 403' }),
    });
    const logged = JSON.stringify(mocks.warn.mock.calls);
    expect(logged).toContain('HTTP 403');
    expect(logged).not.toContain('secret-topic-123');
    expect(logged).not.toContain('enc:v1');
  });

  it('does not send when the saved secrets no longer decrypt', async () => {
    const result = await deliverToChannel(row({ secrets: 'enc:v1:not-really' }), message, ADMIN);
    expect(result).toMatchObject({ ok: false });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe('failure counting', () => {
  it('counts failures within a minute of the last one once, and only moves the time', async () => {
    mocks.send.mockRejectedValue(new ChannelSendError('Timed out'));
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await deliverToChannel(row(), message, ADMIN);
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.updateMany).toHaveBeenLastCalledWith({ where: { id: 'c1' }, data: expect.not.objectContaining({ consecutiveFailures: expect.anything() }) });
  });
});

describe('dispatchToChannels', () => {
  const owned = (extra: Partial<NotificationChannel>, role = 'admin') => ({ ...row(extra), user: { role } });

  it('delivers to every channel even when some fail, and never rejects', async () => {
    mocks.send
      .mockRejectedValueOnce(new ChannelSendError('Timed out'))
      .mockResolvedValue(undefined);
    const sent = await dispatchToChannels([owned({ id: 'a' }), owned({ id: 'b' }), owned({ id: 'c' })], message);
    expect(sent).toBe(2);
    expect(mocks.send).toHaveBeenCalledTimes(3);
  });

  it('sends with the owner\'s reach: LAN for an admin\'s channel only', async () => {
    await dispatchToChannels([owned({ id: 'adm' }, 'admin'), owned({ id: 'mem' }, 'member')], message);
    const rules = (mocks.send.mock.calls as unknown as unknown[][]).map((call) => call[4]);
    expect(rules).toEqual(expect.arrayContaining([{ allowPrivate: true }, { allowPrivate: false }]));
  });

  it('sends a burst to one channel in turn, and drops the rest once one fails', async () => {
    let active = 0;
    let most = 0;
    mocks.send.mockImplementation(async () => {
      active++;
      most = Math.max(most, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      throw new ChannelSendError('Timed out');
    });
    const updatedAt = new Date(Date.now() - 1000);
    const burst = Array.from({ length: 4 }, () => dispatchToChannels([owned({ id: 'dead', updatedAt })], message));
    expect(await Promise.all(burst)).toEqual([0, 0, 0, 0]);
    expect(most).toBe(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
