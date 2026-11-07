import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  buildStatusSummary: vi.fn(),
  buildStatusQueue: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/api-tokens', () => ({ authorizeApiTokenRequest: mocks.authorize }));
vi.mock('@/lib/status-api', () => ({ buildStatusSummary: mocks.buildStatusSummary, buildStatusQueue: mocks.buildStatusQueue }));
vi.mock('@/lib/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/logger')>()),
  logger: { info: mocks.logInfo, warn: mocks.logWarn, error: mocks.logError, debug: vi.fn() },
}));

import { GET as getSummary } from './summary/route';
import { GET as getQueue } from './queue/route';

const TOKEN = `hlp_${'z'.repeat(43)}`;
const USER = { id: 'u1' };

function request(path: string) {
  return new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildStatusSummary.mockResolvedValue({ version: 1, generatedAt: 'now', queue: { total: 1 } });
  mocks.buildStatusQueue.mockResolvedValue({ version: 1, generatedAt: 'now', total: 0, items: [] });
});

describe('/api/v1 routes', () => {
  it('answer only what authorizeApiTokenRequest allows, with its scopes', async () => {
    const scopes = new Set(['activity.view']);
    mocks.authorize.mockResolvedValue({ ok: true, user: USER, tokenId: 't', scopes });
    const response = await getSummary(request('/api/v1/summary'));
    expect(response.status).toBe(200);
    expect(mocks.buildStatusSummary).toHaveBeenCalledWith(USER, scopes);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect((await getQueue(request('/api/v1/queue'))).status).toBe(200);
  });

  it('pass a refusal through unchanged', async () => {
    mocks.authorize.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await getSummary(request('/api/v1/summary'))).status).toBe(401);
    expect((await getQueue(request('/api/v1/queue'))).status).toBe(401);
    expect(mocks.buildStatusSummary).not.toHaveBeenCalled();
    expect(mocks.buildStatusQueue).not.toHaveBeenCalled();
  });

  it('keep the queue to a token whose owner still holds activity.view', async () => {
    mocks.authorize.mockResolvedValue({ ok: true, user: USER, tokenId: 't', scopes: new Set(['calendar.view']) });
    expect((await getQueue(request('/api/v1/queue'))).status).toBe(403);
    expect(mocks.buildStatusQueue).not.toHaveBeenCalled();
  });

  it('never log the token', async () => {
    mocks.authorize.mockResolvedValue({ ok: true, user: USER, tokenId: 't', scopes: new Set(['activity.view']) });
    await getSummary(request('/api/v1/summary?debug=1'));
    mocks.authorize.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    await getQueue(request('/api/v1/queue'));
    const logged = JSON.stringify([...mocks.logInfo.mock.calls, ...mocks.logWarn.mock.calls, ...mocks.logError.mock.calls]);
    expect(logged).toContain('/api/v1/summary');
    expect(logged).not.toContain(TOKEN.slice(4));
  });
});
