import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'u1', username: 'member', role: 'member', capabilities: {} as Record<string, boolean> },
  deleteMany: vi.fn(),
  findUnique: vi.fn(),
  send: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireUserAllCapabilities: async () => ({ ok: true, user: mocks.user }) }));
vi.mock('@/lib/permissions', () => ({ can: (user: typeof mocks.user, cap: string) => user.capabilities[cap] === true }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({ prisma: { manualDownload: { deleteMany: mocks.deleteMany, findUnique: mocks.findUnique } } }));
vi.mock('@/lib/manual-downloads/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/manual-downloads/send')>()),
  sendManualDownload: mocks.send,
}));

import { DELETE } from '../[id]/route';
import { POST } from '../route';

const MAGNET = 'magnet:?xt=urn:btih:382cc016ff22946008ecddcb0dda820f42b0cd5a&dn=Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP';
function sendRequest(extra: Record<string, unknown>) {
  const form = new FormData();
  form.append('request', JSON.stringify({ service: 'RADARR', instanceId: 'i1', externalId: 10331, magnetUrl: MAGNET, clientRequestId: 'req-00001', ...extra }));
  return new Request('http://localhost/api/manual-downloads', { method: 'POST', body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.capabilities = { 'movies.add': true };
});

describe('manual download route guards', () => {
  it('will not unlink a download that is still being sent', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue({ id: 'md1' });
    const res = await DELETE(new Request('http://localhost/api/manual-downloads/md1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'md1' }) });
    expect(res.status).toBe(409);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: 'md1', status: { notIn: ['PREFLIGHT', 'CREATING_MEDIA', 'SUBMITTING_RELEASE'] } } });
  });

  it('needs the monitoring capability to monitor an existing title', async () => {
    const refused = await POST(sendRequest({ monitorTarget: true }));
    expect(refused.status).toBe(403);
    expect(mocks.send).not.toHaveBeenCalled();

    mocks.user.capabilities = { 'movies.add': true, 'movies.editMonitoring': true };
    mocks.send.mockResolvedValue({ id: 'md1', mode: 'ARR_MANAGED', status: 'QUEUED', service: 'RADARR', createdAt: new Date(), updatedAt: new Date(), completedAt: null, events: [] });
    expect((await POST(sendRequest({ monitorTarget: true }))).status).toBe(201);
  });
});
