import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findMany: vi.fn(),
  filterVisibleServiceTypes: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/db', () => ({
  prisma: { serviceConnection: { findMany: mocks.findMany } },
}));
vi.mock('@/lib/server/service-capabilities', () => ({
  filterVisibleServiceTypes: mocks.filterVisibleServiceTypes,
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));

import { GET } from '@/app/api/services/widget-availability/route';

const user = {
  id: 'member-1',
  role: 'member',
  template: 'member',
  permissions: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ ok: true, user, session: {} });
  mocks.findMany.mockResolvedValue([
    { type: 'QBITTORRENT' },
    { type: 'JELLYFIN' },
  ]);
  mocks.filterVisibleServiceTypes.mockReturnValue(['JELLYFIN']);
});

describe('widget service availability', () => {
  it('rejects unauthenticated requests before reading connection metadata', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('returns only capability-scoped service types without cache reuse', async () => {
    const response = await GET();

    expect(mocks.filterVisibleServiceTypes).toHaveBeenCalledWith(
      user,
      ['QBITTORRENT', 'JELLYFIN'],
    );
    await expect(response.json()).resolves.toEqual({ services: ['JELLYFIN'] });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
  });
});
