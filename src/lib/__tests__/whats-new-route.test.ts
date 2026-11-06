import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getWhatsNew: vi.fn(),
  getCurrentReleaseNotes: vi.fn(),
  markWhatsNewSeen: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/app-version', () => ({ APP_VERSION: '1.14.0', GIT_SHA: '' }));
vi.mock('@/lib/whats-new', () => ({
  getWhatsNew: mocks.getWhatsNew,
  getCurrentReleaseNotes: mocks.getCurrentReleaseNotes,
  markWhatsNewSeen: mocks.markWhatsNewSeen,
}));

import { GET, POST } from '@/app/api/whats-new/route';

const get = (query = '') => GET(new NextRequest(`http://helprr.test/api/whats-new${query}`));
const post = (body: unknown) =>
  POST(new NextRequest('http://helprr.test/api/whats-new', { method: 'POST', body: JSON.stringify(body) }));

describe('/api/whats-new', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'user-1', role: 'member' }, session: { id: 's' } });
    mocks.getWhatsNew.mockResolvedValue({ version: '1.14.0', releases: [], omitted: 0 });
    mocks.getCurrentReleaseNotes.mockResolvedValue({ version: '1.14.0', releases: [], omitted: 0 });
  });

  it('refuses a signed-out request before reading or writing anything', async () => {
    mocks.requireUser.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await get()).status).toBe(401);
    expect((await post({ version: '1.14.0' })).status).toBe(401);
    expect(mocks.getWhatsNew).not.toHaveBeenCalled();
    expect(mocks.markWhatsNewSeen).not.toHaveBeenCalled();
  });

  it("returns the user's own notes uncached; ?current=1 reads the running release only", async () => {
    const response = await get();
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.getWhatsNew).toHaveBeenCalledWith('user-1');
    await get('?current=1');
    expect(mocks.getCurrentReleaseNotes).toHaveBeenCalledTimes(1);
    expect(mocks.getWhatsNew).toHaveBeenCalledTimes(1);
  });

  it('marks the shown version seen', async () => {
    expect((await post({ version: '1.13.1' })).status).toBe(200);
    expect(mocks.markWhatsNewSeen).toHaveBeenCalledWith('user-1', '1.13.1');
  });

  it.each([
    ['a version newer than the server', { version: '1.15.0' }],
    ['a branch name', { version: 'development' }],
    ['no version', {}],
    ['no body', null],
  ])('refuses %s', async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.markWhatsNewSeen).not.toHaveBeenCalled();
  });
});
