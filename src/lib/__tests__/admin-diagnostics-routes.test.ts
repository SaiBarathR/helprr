import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  checkForUpdates: vi.fn(),
  buildSupportBundle: vi.fn(),
  serializeSupportBundle: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/update-check', () => ({ checkForUpdates: mocks.checkForUpdates }));
vi.mock('@/lib/support-bundle', () => ({
  buildSupportBundle: mocks.buildSupportBundle,
  serializeSupportBundle: mocks.serializeSupportBundle,
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));

import { GET as getUpdateCheck } from '@/app/api/admin/update-check/route';
import { GET as getSupportBundle } from '@/app/api/admin/support-bundle/route';

describe('admin diagnostic routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      user: { id: 'admin', role: 'admin' },
      session: { id: 'session' },
    });
  });

  it.each([
    ['update check', getUpdateCheck, mocks.checkForUpdates],
    ['support bundle', getSupportBundle, mocks.buildSupportBundle],
  ])('rejects a member before creating the %s', async (_label, handler, operation) => {
    mocks.requireAdmin.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await handler();

    expect(response.status).toBe(403);
    expect(operation).not.toHaveBeenCalled();
  });

  it('returns a private, uncached update result', async () => {
    mocks.checkForUpdates.mockResolvedValue({
      status: 'up_to_date',
      currentVersion: '1.0.0',
      latestVersion: '1.0.0',
      releaseUrl: 'https://github.com/saibarathr/helprr/releases/tag/v1.0.0',
      publishedAt: null,
      checkedAt: '2026-07-14T12:00:00.000Z',
    });

    const response = await getUpdateCheck();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('downloads the support bundle with safe attachment headers', async () => {
    mocks.buildSupportBundle.mockResolvedValue({
      generatedAt: '2026-07-14T12:00:00.000Z',
    });
    mocks.serializeSupportBundle.mockReturnValue('{"safe":true}\n');

    const response = await getSupportBundle();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('content-disposition')).toContain('attachment; filename="helprr-support-');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('{"safe":true}\n');
  });
});
