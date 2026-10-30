import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  retryJob: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({ prisma: { twitchJob: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } } }));
vi.mock('@/lib/twitch/jobs', () => ({ retryJob: mocks.retryJob, ACTIVE_JOB_STATES: ['RUNNING'] }));

import { POST as cancel } from '@/app/api/twitch/jobs/[id]/cancel/route';
import { POST as retry } from '@/app/api/twitch/jobs/[id]/retry/route';

const permissions = (...caps: string[]) => Object.fromEntries(caps.map((cap) => [cap, true]));
const member = (...caps: string[]) => ({
  ok: true,
  user: { id: 'me', username: 'me', role: 'member', template: 'member', permissions: permissions(...caps) },
});
const call = (handler: typeof retry) => handler(new NextRequest('http://x/'), { params: Promise.resolve({ id: 'j1' }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.retryJob.mockResolvedValue('retried');
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe('retry', () => {
  it('lets a downloader retry their own download', async () => {
    mocks.requireUser.mockResolvedValue(member('twitch.download'));
    mocks.findUnique.mockResolvedValue({ kind: 'DOWNLOAD', requestedByUserId: 'me' });
    expect((await call(retry)).status).toBe(200);
  });

  it("refuses someone else's download", async () => {
    mocks.requireUser.mockResolvedValue(member('twitch.download'));
    mocks.findUnique.mockResolvedValue({ kind: 'DOWNLOAD', requestedByUserId: 'other' });
    expect((await call(retry)).status).toBe(403);
    expect(mocks.retryJob).not.toHaveBeenCalled();
  });

  it.each(['DELETE_FILES', 'REENCODE'])('refuses %s without twitch.manage, even for its requester', async (kind) => {
    mocks.requireUser.mockResolvedValue(member('twitch.download'));
    mocks.findUnique.mockResolvedValue({ kind, requestedByUserId: 'me' });
    expect((await call(retry)).status).toBe(403);
    expect(mocks.retryJob).not.toHaveBeenCalled();
  });

  it('refuses a requester who lost twitch.download', async () => {
    mocks.requireUser.mockResolvedValue(member());
    mocks.findUnique.mockResolvedValue({ kind: 'DOWNLOAD', requestedByUserId: 'me' });
    expect((await call(retry)).status).toBe(403);
  });

  it('lets twitch.manage retry a delete, as itself', async () => {
    mocks.requireUser.mockResolvedValue(member('twitch.manage'));
    mocks.findUnique.mockResolvedValue({ kind: 'DELETE_FILES', requestedByUserId: 'other' });
    expect((await call(retry)).status).toBe(200);
    expect(mocks.retryJob).toHaveBeenCalledWith('j1', { id: 'me', username: 'me' });
  });

  it('reports a second active download as a conflict', async () => {
    mocks.requireUser.mockResolvedValue(member('twitch.manage'));
    mocks.findUnique.mockResolvedValue({ kind: 'DOWNLOAD', requestedByUserId: 'other' });
    mocks.retryJob.mockResolvedValue('active');
    expect((await call(retry)).status).toBe(409);
  });

  it('fails closed without a session', async () => {
    const response = new Response(null, { status: 401 });
    mocks.requireUser.mockResolvedValue({ ok: false, response });
    expect((await call(retry)).status).toBe(401);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});

describe('cancel', () => {
  it("refuses someone else's job", async () => {
    mocks.requireUser.mockResolvedValue(member('twitch.download'));
    mocks.findUnique.mockResolvedValue({ state: 'RUNNING', requestedByUserId: 'other' });
    expect((await call(cancel)).status).toBe(403);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('lets twitch.manage cancel anyone', async () => {
    mocks.requireUser.mockResolvedValue(member('twitch.manage'));
    mocks.findUnique.mockResolvedValue({ state: 'QUEUED', requestedByUserId: 'other' });
    expect((await call(cancel)).status).toBe(200);
  });
});
