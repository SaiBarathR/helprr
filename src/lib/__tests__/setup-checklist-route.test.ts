import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getSetupChecklist: vi.fn(),
  markSetupStepDone: vi.fn(),
  dismissSetupChecklist: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/setup-checklist', async () => ({
  ...(await vi.importActual<typeof import('@/lib/setup-checklist-steps')>('@/lib/setup-checklist-steps')),
  getSetupChecklist: mocks.getSetupChecklist,
  markSetupStepDone: mocks.markSetupStepDone,
  dismissSetupChecklist: mocks.dismissSetupChecklist,
}));

import { GET, POST } from '@/app/api/setup-checklist/route';

const post = (body: unknown) =>
  POST(new NextRequest('http://helprr.test/api/setup-checklist', { method: 'POST', body: JSON.stringify(body) }));

describe('/api/setup-checklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: 'admin-1', role: 'admin' }, session: { id: 's' } });
    mocks.getSetupChecklist.mockResolvedValue({ hidden: false, done: {} });
  });

  it('refuses a member before reading or writing anything', async () => {
    const forbidden = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    mocks.requireAdmin.mockResolvedValue(forbidden);
    expect((await GET()).status).toBe(403);
    expect((await post({ action: 'dismiss' })).status).toBe(403);
    expect(mocks.getSetupChecklist).not.toHaveBeenCalled();
    expect(mocks.dismissSetupChecklist).not.toHaveBeenCalled();
  });

  it("returns the admin's own checklist, uncached", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.getSetupChecklist).toHaveBeenCalledWith('admin-1');
  });

  it('dismisses it, and marks a step the server cannot see', async () => {
    expect((await post({ action: 'dismiss' })).status).toBe(200);
    expect(mocks.dismissSetupChecklist).toHaveBeenCalledWith('admin-1');
    expect((await post({ action: 'done', step: 'install' })).status).toBe(200);
    expect(mocks.markSetupStepDone).toHaveBeenCalledWith('admin-1', 'install');
  });

  it.each([
    ['a step the server reads itself', { action: 'done', step: 'service' }],
    ['push, which needs a real device', { action: 'done', step: 'push' }],
    ['an unknown step', { action: 'done', step: 'everything' }],
    ['an unknown action', { action: 'reset' }],
    ['no body', null],
  ])('refuses %s', async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.markSetupStepDone).not.toHaveBeenCalled();
    expect(mocks.dismissSetupChecklist).not.toHaveBeenCalled();
  });
});
