import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { ok: true, user: { id: 'u', username: 'sai' } } as { ok: boolean; user?: object; response?: Response },
  heartbeat: vi.fn(),
  settings: vi.fn(),
  update: vi.fn(),
  requestReencode: vi.fn(),
  requestOriginalJob: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: <T,>(handler: T) => handler }));
vi.mock('@/lib/db', () => ({
  prisma: {
    twitchWorkerHeartbeat: { findFirst: mocks.heartbeat },
    twitchSettings: { findUnique: mocks.settings },
    twitchMediaFile: { updateMany: mocks.update },
  },
}));
vi.mock('@/lib/twitch/files', () => ({
  requestReencode: mocks.requestReencode,
  requestOriginalJob: mocks.requestOriginalJob,
  FILE_SELECT: { video: { select: {} } },
  fileTimeline: vi.fn(),
  serializeFile: vi.fn(),
}));
vi.mock('@/lib/twitch/retention', () => ({ enqueueFileDelete: vi.fn(), fileCleanupStatus: vi.fn(), loadPlayedDates: vi.fn() }));

import { PATCH } from './[id]/route';
import { DELETE as deleteOriginal } from './[id]/original/route';
import { POST as restore } from './[id]/original/restore/route';
import { POST as reencode } from './[id]/reencode/route';

const context = { params: Promise.resolve({ id: 'f' }) };
const request = (body?: unknown) => new NextRequest('http://localhost/api', {
  method: 'POST',
  body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth = { ok: true, user: { id: 'u', username: 'sai' } };
  mocks.heartbeat.mockResolvedValue({ gpuAvailable: true });
  mocks.settings.mockResolvedValue({ reencodeEnabled: true });
  mocks.requestReencode.mockResolvedValue('queued');
  mocks.requestOriginalJob.mockResolvedValue('queued');
});

describe('POST reencode', () => {
  it('refuses before doing anything when the user may not manage', async () => {
    mocks.auth = { ok: false, response: new Response(null, { status: 403 }) };
    const res = await reencode(request({ when: 'now' }), context);
    expect(res.status).toBe(403);
    expect(mocks.requestReencode).not.toHaveBeenCalled();
  });

  it('needs to know when', async () => {
    expect((await reencode(request({ when: 'whenever' }), context)).status).toBe(400);
  });

  it('says why when there is no GPU, rather than queue something that never runs', async () => {
    mocks.heartbeat.mockResolvedValue({ gpuAvailable: false });
    expect((await reencode(request({ when: 'now' }), context)).status).toBe(409);
    expect(mocks.requestReencode).not.toHaveBeenCalled();
  });

  it('refuses tonight while night re-encoding is off, but still allows now', async () => {
    mocks.settings.mockResolvedValue({ reencodeEnabled: false });
    expect((await reencode(request({ when: 'tonight' }), context)).status).toBe(409);
    expect((await reencode(request({ when: 'now' }), context)).status).toBe(202);
  });

  it.each([['missing', 404], ['nothing-to-do', 409], ['busy', 409], ['queued', 202]])('answers %s with %i', async (result, status) => {
    mocks.requestReencode.mockResolvedValue(result);
    expect((await reencode(request({ when: 'now' }), context)).status).toBe(status);
  });
});

describe('the original', () => {
  it.each([['missing', 404], ['nothing-to-do', 409], ['busy', 409], ['queued', 202]])('answers %s with %i', async (result, status) => {
    mocks.requestOriginalJob.mockResolvedValue(result);
    expect((await restore(request(), context)).status).toBe(status);
    expect((await deleteOriginal(request(), context)).status).toBe(status);
  });

  it('asks for the job that matches the route', async () => {
    await restore(request(), context);
    await deleteOriginal(request(), context);
    expect(mocks.requestOriginalJob.mock.calls.map((call) => call[1])).toEqual(['RESTORE_ORIGINAL', 'DELETE_ORIGINAL']);
  });
});

describe('PATCH keep forever', () => {
  it('needs a real answer', async () => {
    expect((await PATCH(request({ keepForever: 'yes' }), context)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('reports a file that is gone', async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    expect((await PATCH(request({ keepForever: true }), context)).status).toBe(404);
  });

  it('saves it', async () => {
    mocks.update.mockResolvedValue({ count: 1 });
    expect((await PATCH(request({ keepForever: true }), context)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'f' }, data: { keepForever: true } });
  });
});
